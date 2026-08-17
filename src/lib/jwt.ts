import { SignJWT, jwtVerify } from 'jose';

// Kept free of `next/headers` and Prisma imports so the Edge middleware can
// verify tokens without dragging Node-only code into the Edge bundle.

/**
 * The signing key is the whole of session security: anything that holds it can
 * mint an access token for any admin. It is therefore resolved strictly — an
 * unset, placeholder or too-short value fails the request rather than quietly
 * signing with a guessable key, which would leave the app looking healthy while
 * every session on it was forgeable.
 */
const MIN_SECRET_LENGTH = 32;

/** Values shipped in .env.example. Present means the env was never filled in. */
const PLACEHOLDER_SECRETS = new Set([
  'change-me-to-a-long-random-string',
  'change-me',
  'secret',
]);

let cachedKey: Uint8Array | null = null;

function signingKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const secret = (process.env.SESSION_SECRET || '').trim();

  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set. Sessions cannot be signed without it — generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
    );
  }
  if (PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error('SESSION_SECRET is still the placeholder from .env.example. Generate a real one.');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters, got ${secret.length}.`
    );
  }

  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

/** Drops the memoized key. For tests that swap the environment. */
export function resetSigningKey() {
  cachedKey = null;
}

/** True when the environment can sign and verify sessions. Never throws. */
export function isSessionSecretConfigured(): boolean {
  try {
    signingKey();
    return true;
  } catch {
    return false;
  }
}

export const ACCESS_TOKEN_EXP = '15m';
export const ACCESS_TOKEN_MINUTES = 15;
export const REFRESH_TOKEN_DAYS = 7;

export async function encryptJwt(payload: Record<string, unknown>, expiresIn: string) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

export async function decryptJwt<T = any>(token: string): Promise<T | null> {
  try {
    // `algorithms` is pinned so a token carrying `alg: none` — or any algorithm
    // we did not choose — is rejected before the signature is even considered.
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * Web Crypto, present in both the Node and Edge runtimes. There is deliberately
 * no `Math.random()` fallback: these values become session identifiers, so a
 * predictable one is a hijackable session. A runtime without a CSPRNG must fail
 * loudly rather than hand back a guessable id.
 */
function webCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) {
    throw new Error('No cryptographically secure random source is available in this runtime.');
  }
  return c;
}

export function uuid(): string {
  const c = webCrypto();
  if (c.randomUUID) return c.randomUUID();

  // RFC 4122 v4 from CSPRNG bytes, for runtimes exposing getRandomValues only.
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A uniformly distributed integer in [0, max). Rejection-sampled, so no modulo bias. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000) {
    throw new Error(`secureRandomInt: max must be an integer in 1..2^32, got ${max}`);
  }
  const c = webCrypto();
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    c.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

export function expiryFromDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function expiryFromMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}
