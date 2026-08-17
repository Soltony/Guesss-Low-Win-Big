import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BidAmountCipherError,
  decryptBidAmount,
  describeBidAmountKeys,
  encryptBidAmount,
  isBidAmountKeyConfigured,
  resetBidAmountKeyring,
  tryDecryptBidAmount,
} from './bid-crypto';

const KEY_A = Buffer.alloc(32, 0xa1).toString('base64');
const KEY_B = Buffer.alloc(32, 0xb2).toString('base64');

const scope = { auctionId: 'auction_1', bidderId: 'bidder_1' };

function withKeys(primary?: string, previous?: string) {
  if (primary === undefined) delete process.env.BID_ENCRYPTION_KEY;
  else process.env.BID_ENCRYPTION_KEY = primary;

  if (previous === undefined) delete process.env.BID_ENCRYPTION_KEY_PREVIOUS;
  else process.env.BID_ENCRYPTION_KEY_PREVIOUS = previous;

  resetBidAmountKeyring();
}

beforeEach(() => withKeys(KEY_A));
afterEach(() => withKeys(undefined, undefined));

describe('encryptBidAmount / decryptBidAmount', () => {
  it('round-trips an amount exactly', () => {
    const sealed = encryptBidAmount(2.5, scope);
    expect(decryptBidAmount(sealed, scope)).toBe(2.5);
  });

  it('keeps cent precision at both ends of the range', () => {
    for (const amount of [0.01, 1.0, 9.99, 100.5, 1_234_567.89]) {
      expect(decryptBidAmount(encryptBidAmount(amount, scope), scope)).toBe(amount);
    }
  });

  it('normalises to two decimals, matching the uniqueness grouping key', () => {
    // rankUniqueBids groups on amount.toFixed(2), so 2 and 2.00 must survive a
    // round trip as the same number or the winner calculation would split them.
    expect(decryptBidAmount(encryptBidAmount(2, scope), scope)).toBe(
      decryptBidAmount(encryptBidAmount(2.0, scope), scope)
    );
  });

  it('produces a different ciphertext every time, so equal bids do not look equal', () => {
    // The whole auction turns on which amounts are duplicated. A deterministic
    // ciphertext would hand that away to anyone who can read the table.
    const sealed = new Set(Array.from({ length: 25 }, () => encryptBidAmount(5, scope)));
    expect(sealed.size).toBe(25);
  });

  it('leaks no plaintext into the envelope', () => {
    const sealed = encryptBidAmount(1337.42, scope);
    expect(sealed).not.toContain('1337');
    expect(sealed).not.toContain('42');
  });

  it('refuses a ciphertext moved to another bidder', () => {
    const sealed = encryptBidAmount(2.5, scope);
    expect(() => decryptBidAmount(sealed, { ...scope, bidderId: 'bidder_2' })).toThrow(
      BidAmountCipherError
    );
  });

  it('refuses a ciphertext moved to another auction', () => {
    const sealed = encryptBidAmount(2.5, scope);
    expect(() => decryptBidAmount(sealed, { ...scope, auctionId: 'auction_2' })).toThrow(
      BidAmountCipherError
    );
  });

  it('refuses a tampered ciphertext body', () => {
    const parts = encryptBidAmount(2.5, scope).split('.');
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 0xff;
    parts[3] = body.toString('base64url');
    expect(() => decryptBidAmount(parts.join('.'), scope)).toThrow(BidAmountCipherError);
  });

  it('rejects a malformed envelope rather than guessing', () => {
    for (const bad of ['', 'not-an-envelope', 'v1.aaaaaaaa.short', 'v2.aaaaaaaa.aa.bb']) {
      expect(() => decryptBidAmount(bad, scope)).toThrow(BidAmountCipherError);
    }
  });

  it('rejects an amount sealed under a key that is no longer configured', () => {
    const sealed = encryptBidAmount(2.5, scope);
    withKeys(KEY_B);
    expect(() => decryptBidAmount(sealed, scope)).toThrow(/No configured key matches/);
  });
});

describe('key rotation', () => {
  it('still opens old rows while sealing new ones under the new key', () => {
    const underOld = encryptBidAmount(3.25, scope);
    const oldKeyId = describeBidAmountKeys().active;

    // Rotate: the outgoing key stays configured for decryption only.
    withKeys(KEY_B, KEY_A);

    const { active, accepted } = describeBidAmountKeys();
    expect(active).not.toBe(oldKeyId);
    expect(accepted).toContain(oldKeyId);

    expect(decryptBidAmount(underOld, scope)).toBe(3.25);

    const underNew = encryptBidAmount(4.75, scope);
    expect(underNew.split('.')[1]).toBe(active);
    expect(decryptBidAmount(underNew, scope)).toBe(4.75);
  });
});

describe('key configuration', () => {
  it('reports when no key is available instead of failing silently', () => {
    withKeys(undefined);
    expect(isBidAmountKeyConfigured()).toBe(false);
    expect(() => encryptBidAmount(1, scope)).toThrow(/BID_ENCRYPTION_KEY is not set/);
  });

  it('rejects a key of the wrong length', () => {
    withKeys(Buffer.alloc(16, 1).toString('base64'));
    expect(() => encryptBidAmount(1, scope)).toThrow(/must decode to 32 bytes/);
  });

  it('accepts a hex-encoded key as well as base64', () => {
    withKeys(Buffer.alloc(32, 0xc3).toString('hex'));
    expect(decryptBidAmount(encryptBidAmount(7.5, scope), scope)).toBe(7.5);
  });
});

describe('tryDecryptBidAmount', () => {
  it('returns null rather than throwing on an unreadable row', () => {
    expect(tryDecryptBidAmount('garbage', scope)).toBeNull();
    expect(tryDecryptBidAmount(encryptBidAmount(2, scope), { ...scope, bidderId: 'x' })).toBeNull();
  });

  it('returns the amount when the row is readable', () => {
    expect(tryDecryptBidAmount(encryptBidAmount(2, scope), scope)).toBe(2);
  });
});
