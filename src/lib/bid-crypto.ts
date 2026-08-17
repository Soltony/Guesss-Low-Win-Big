import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for bid amounts.
 *
 * In a lowest-unique-bid auction the amounts *are* the game: anyone who can
 * read the distribution knows which amount wins. So an amount is never written
 * to the database in the clear — only as AES-256-GCM ciphertext whose key lives
 * in the environment. A stolen backup, a read-only SQL account, or a `SELECT *`
 * in a support session all come back with nothing usable.
 *
 * Envelope layout, dot-separated with every part base64url:
 *
 *   v1.<keyId>.<iv>.<ciphertext‖tag>
 *
 * `keyId` is a fingerprint of the key that sealed the row, not the key itself.
 * It is what lets two keys be configured at once during a rotation: rows keep
 * decrypting under the old key while new rows are sealed under the new one.
 *
 * The additional authenticated data binds each ciphertext to the auction and
 * bidder it belongs to, so a ciphertext lifted out of one row and pasted into
 * another fails authentication instead of silently changing someone's bid.
 * Amounts are sealed as their fixed 2-decimal string — the same form
 * `rankUniqueBids` groups on — so a round-trip can never drift the value that
 * decides the winner.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const PRIMARY_ENV = 'BID_ENCRYPTION_KEY';
const PREVIOUS_ENV = 'BID_ENCRYPTION_KEY_PREVIOUS';

export class BidAmountCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidAmountCipherError';
  }
}

/** What a ciphertext is bound to. Both parts are known before the row exists. */
export interface BidAmountScope {
  auctionId: string;
  bidderId: string;
}

interface LoadedKey {
  id: string;
  material: Buffer;
}

interface Keyring {
  active: LoadedKey;
  byId: Map<string, LoadedKey>;
}

let cached: Keyring | null = null;

function parseKeyMaterial(raw: string, envName: string): Buffer {
  const trimmed = raw.trim();
  const material = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (material.length !== KEY_BYTES) {
    throw new BidAmountCipherError(
      `${envName} must decode to ${KEY_BYTES} bytes, got ${material.length}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  return material;
}

/** A short fingerprint of the key — enough to identify it, useless without it. */
function keyIdFor(material: Buffer) {
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}

/**
 * Keys are read on first use rather than at import, so a build or a test that
 * never touches a bid amount does not need them configured.
 */
function keyring(): Keyring {
  if (cached) return cached;

  const primary = process.env[PRIMARY_ENV];
  if (!primary) {
    throw new BidAmountCipherError(
      `${PRIMARY_ENV} is not set. Bid amounts cannot be read or written without it — ` +
        `see .env.example for how to generate one.`
    );
  }

  const material = parseKeyMaterial(primary, PRIMARY_ENV);
  const active: LoadedKey = { id: keyIdFor(material), material };
  const byId = new Map<string, LoadedKey>([[active.id, active]]);

  // Decrypt-only. Present for as long as rows sealed by the outgoing key remain.
  const previous = process.env[PREVIOUS_ENV];
  if (previous) {
    const old = parseKeyMaterial(previous, PREVIOUS_ENV);
    const id = keyIdFor(old);
    if (!byId.has(id)) byId.set(id, { id, material: old });
  }

  cached = { active, byId };
  return cached;
}

/** Drops the memoized keyring. Tests and the rotation script re-read the env. */
export function resetBidAmountKeyring() {
  cached = null;
}

/** True when the environment can seal and open bid amounts. Never throws. */
export function isBidAmountKeyConfigured(): boolean {
  try {
    keyring();
    return true;
  } catch {
    return false;
  }
}

/** Key fingerprints for health checks and the migration scripts. No material. */
export function describeBidAmountKeys(): { active: string; accepted: string[] } {
  const ring = keyring();
  return { active: ring.active.id, accepted: Array.from(ring.byId.keys()) };
}

function aad(scope: BidAmountScope): Buffer {
  return Buffer.from(`bid:${scope.auctionId}|${scope.bidderId}`, 'utf8');
}

export function encryptBidAmount(amount: number, scope: BidAmountScope): string {
  if (!Number.isFinite(amount)) {
    throw new BidAmountCipherError('Bid amount must be a finite number.');
  }
  if (!scope.auctionId || !scope.bidderId) {
    throw new BidAmountCipherError('Bid amounts must be sealed against an auction and a bidder.');
  }

  const { active } = keyring();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', active.material, iv);
  cipher.setAAD(aad(scope));

  const body = Buffer.concat([
    cipher.update(amount.toFixed(2), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return [VERSION, active.id, iv.toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptBidAmount(envelope: string, scope: BidAmountScope): number {
  const parts = String(envelope ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new BidAmountCipherError('Unrecognised bid amount envelope.');
  }

  const [, keyId, ivPart, bodyPart] = parts;
  const key = keyring().byId.get(keyId);
  if (!key) {
    throw new BidAmountCipherError(
      `No configured key matches fingerprint ${keyId}. ` +
        `Set ${PREVIOUS_ENV} to the key this row was sealed with.`
    );
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) {
    throw new BidAmountCipherError('Malformed bid amount envelope.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key.material, iv);
  decipher.setAAD(aad(scope));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));

  let plain: string;
  try {
    plain = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM rejected the tag: wrong key, a tampered row, or a ciphertext moved
    // here from another bid. Never fall back to a guess.
    throw new BidAmountCipherError(
      'Bid amount failed authentication — wrong key, or the stored row was altered.'
    );
  }

  const value = Number(plain);
  if (!Number.isFinite(value)) {
    throw new BidAmountCipherError('Decrypted bid amount is not a number.');
  }
  return value;
}

/**
 * Decrypt without throwing, for list views where one unreadable row must not
 * take the whole page down. Anything that decides money — settlement above all
 * — uses `decryptBidAmount` so a bad row surfaces instead of being skipped.
 */
export function tryDecryptBidAmount(envelope: string, scope: BidAmountScope): number | null {
  try {
    return decryptBidAmount(envelope, scope);
  } catch {
    return null;
  }
}
