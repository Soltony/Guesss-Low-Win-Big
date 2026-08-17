import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptBidAmount, resetBidAmountKeyring } from './bid-crypto';
import {
  ADMIN_VIEWER,
  MASKED_AMOUNT,
  auctionAmountsRevealed,
  canRevealBidAmount,
  formatRevealedAmount,
  revealBidAmount,
} from './bid-visibility';

const KEY = Buffer.alloc(32, 0x5e).toString('base64');

const OWNER = 'bidder_owner';
const RIVAL = 'bidder_rival';
const AUCTION = 'auction_1';

function sealedBid(amount: number, bidderId = OWNER) {
  return {
    bidderId,
    auctionId: AUCTION,
    amountCipher: encryptBidAmount(amount, { auctionId: AUCTION, bidderId }),
  };
}

beforeEach(() => {
  process.env.BID_ENCRYPTION_KEY = KEY;
  resetBidAmountKeyring();
});

afterEach(() => {
  delete process.env.BID_ENCRYPTION_KEY;
  resetBidAmountKeyring();
});

describe('auctionAmountsRevealed', () => {
  it('reveals only once the auction has settled', () => {
    for (const status of ['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']) {
      expect(auctionAmountsRevealed({ status })).toBe(false);
    }
    expect(auctionAmountsRevealed({ status: 'SETTLED' })).toBe(true);
  });

  it('keeps an ENDED auction sealed, because it can still be re-settled', () => {
    expect(auctionAmountsRevealed({ status: 'ENDED' })).toBe(false);
  });
});

describe('canRevealBidAmount', () => {
  const bid = { bidderId: OWNER };

  it('always lets a bidder read their own amount, however live the auction', () => {
    for (const status of ['SCHEDULED', 'LIVE', 'ENDED', 'SETTLED']) {
      expect(canRevealBidAmount(bid, { status }, { bidderId: OWNER })).toBe(true);
    }
  });

  it('hides one bidder’s amount from another until settlement', () => {
    expect(canRevealBidAmount(bid, { status: 'LIVE' }, { bidderId: RIVAL })).toBe(false);
    expect(canRevealBidAmount(bid, { status: 'ENDED' }, { bidderId: RIVAL })).toBe(false);
    expect(canRevealBidAmount(bid, { status: 'SETTLED' }, { bidderId: RIVAL })).toBe(true);
  });

  it('gives admin staff no ownership claim on a live auction', () => {
    expect(canRevealBidAmount(bid, { status: 'LIVE' }, ADMIN_VIEWER)).toBe(false);
    expect(canRevealBidAmount(bid, { status: 'ENDED' }, ADMIN_VIEWER)).toBe(false);
    expect(canRevealBidAmount(bid, { status: 'SETTLED' }, ADMIN_VIEWER)).toBe(true);
  });

  it('does not treat a missing viewer id as matching a bid', () => {
    expect(canRevealBidAmount({ bidderId: '' }, { status: 'LIVE' }, { bidderId: '' })).toBe(false);
    expect(canRevealBidAmount(bid, { status: 'LIVE' }, { bidderId: null })).toBe(false);
  });
});

describe('revealBidAmount', () => {
  it('returns the amount to its owner mid-auction', () => {
    expect(revealBidAmount(sealedBid(2.5), { status: 'LIVE' }, { bidderId: OWNER })).toBe(2.5);
  });

  it('withholds the number entirely from a rival mid-auction', () => {
    expect(revealBidAmount(sealedBid(2.5), { status: 'LIVE' }, { bidderId: RIVAL })).toBeNull();
  });

  it('withholds the number from admin staff mid-auction', () => {
    expect(revealBidAmount(sealedBid(2.5), { status: 'LIVE' }, ADMIN_VIEWER)).toBeNull();
  });

  it('releases the amount to everyone once the auction settles', () => {
    const bid = sealedBid(2.5);
    expect(revealBidAmount(bid, { status: 'SETTLED' }, ADMIN_VIEWER)).toBe(2.5);
    expect(revealBidAmount(bid, { status: 'SETTLED' }, { bidderId: RIVAL })).toBe(2.5);
  });

  it('returns null for an unreadable row instead of throwing', () => {
    const broken = { bidderId: OWNER, auctionId: AUCTION, amountCipher: 'garbage' };
    expect(revealBidAmount(broken, { status: 'SETTLED' }, ADMIN_VIEWER)).toBeNull();
  });

  it('does not decrypt at all when the policy withholds', () => {
    // A withheld row is masked on policy alone, so a ciphertext that would fail
    // to open never even reaches the cipher.
    const broken = { bidderId: OWNER, auctionId: AUCTION, amountCipher: 'garbage' };
    expect(revealBidAmount(broken, { status: 'LIVE' }, ADMIN_VIEWER)).toBeNull();
  });
});

describe('formatRevealedAmount', () => {
  it('masks a withheld amount', () => {
    expect(formatRevealedAmount(null)).toBe(MASKED_AMOUNT);
    expect(formatRevealedAmount(null, 'Br')).toBe(MASKED_AMOUNT);
  });

  it('formats a disclosed amount to two decimals', () => {
    expect(formatRevealedAmount(2.5)).toBe('2.50');
    expect(formatRevealedAmount(2.5, 'Br')).toBe('2.50 Br');
  });

  it('formats zero rather than treating it as absent', () => {
    expect(formatRevealedAmount(0)).toBe('0.00');
  });
});
