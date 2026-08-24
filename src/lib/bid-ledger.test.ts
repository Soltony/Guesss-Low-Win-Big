import { describe, expect, it } from 'vitest';
import { buildBidLedger } from './bid-ledger';
import { rankUniqueBids } from './auction-engine';

const at = (minutes: number) => new Date(2026, 0, 1, 12, minutes);

function bid(id: string, bidderId: string, amount: number, minute = 0) {
  return { id, bidderId, amount, createdAt: at(minute) };
}

/** The ledger a real settlement would publish for these bids. */
function ledgerFor(bids: ReturnType<typeof bid>[]) {
  return buildBidLedger(bids, rankUniqueBids(bids));
}

describe('buildBidLedger', () => {
  it('groups every amount and counts the bids on it', () => {
    const ledger = ledgerFor([
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 3.0),
      bid('e', 'u5', 3.0),
      bid('f', 'u6', 4.0),
    ]);

    expect(ledger.map((entry) => [entry.amount, entry.bidCount])).toEqual([
      [1, 2],
      [2, 1],
      [3, 2],
      [4, 1],
    ]);
  });

  it('marks the winning amount rank 1 and leaves matched amounts unranked', () => {
    const ledger = ledgerFor([
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 3.0),
      bid('e', 'u5', 3.0),
      bid('f', 'u6', 4.0),
    ]);

    const byAmount = new Map(ledger.map((entry) => [entry.amount, entry]));
    expect(byAmount.get(2)?.uniqueRank).toBe(1);
    expect(byAmount.get(4)?.uniqueRank).toBe(2);
    expect(byAmount.get(1)?.uniqueRank).toBeNull();
    expect(byAmount.get(3)?.uniqueRank).toBeNull();
  });

  it('agrees with the ranking about which amounts stood alone', () => {
    const bids = [
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 3.0),
      bid('e', 'u5', 3.0),
      bid('f', 'u6', 4.0),
    ];
    const ranked = rankUniqueBids(bids);
    const ledger = buildBidLedger(bids, ranked);

    // The table a bidder reads and the ranking that awarded the item have to
    // be the same computation, or the ledger disproves the result it explains.
    expect(ledger.filter((entry) => entry.isUnique).map((entry) => entry.amount)).toEqual(
      ranked.map((entry) => entry.amount)
    );
    for (const entry of ledger) {
      expect(entry.isUnique).toBe(entry.uniqueRank !== null);
    }
  });

  it('sorts ascending by true numeric value, not by string', () => {
    const ledger = ledgerFor([
      bid('a', 'u1', 10.0),
      bid('b', 'u2', 2.5),
      bid('c', 'u3', 1.09),
      bid('d', 'u4', 1.1),
    ]);

    expect(ledger.map((entry) => entry.amount)).toEqual([1.09, 1.1, 2.5, 10]);
  });

  it('treats 2 and 2.00 as one amount', () => {
    const ledger = ledgerFor([bid('a', 'u1', 2), bid('b', 'u2', 2.0), bid('c', 'u3', 5.5)]);

    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ amount: 2, bidCount: 2, isUnique: false });
  });

  it('records a bidder once per bid, in the order they were placed', () => {
    const ledger = ledgerFor([
      bid('a', 'u1', 1.5, 0),
      bid('b', 'u2', 1.5, 5),
      // The same bidder twice at one amount is two bids, not one.
      bid('c', 'u1', 1.5, 9),
    ]);

    expect(ledger[0].bidderIds).toEqual(['u1', 'u2', 'u1']);
    expect(ledger[0].bidCount).toBe(3);
    expect(ledger[0].isUnique).toBe(false);
  });

  it('publishes a full ledger for an auction nobody won', () => {
    const ledger = ledgerFor([
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 2.0),
    ]);

    expect(ledger).toHaveLength(2);
    expect(ledger.every((entry) => !entry.isUnique)).toBe(true);
    expect(ledger.every((entry) => entry.uniqueRank === null)).toBe(true);
  });

  it('returns nothing for an auction with no bids', () => {
    expect(ledgerFor([])).toEqual([]);
  });

  it('accounts for every bid exactly once', () => {
    const bids = [
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 1.01),
      bid('d', 'u4', 1.02),
      bid('e', 'u5', 1.02),
      bid('f', 'u6', 1.02),
    ];
    const ledger = ledgerFor(bids);

    const counted = ledger.reduce((sum, entry) => sum + entry.bidCount, 0);
    expect(counted).toBe(bids.length);
    expect(ledger.reduce((sum, entry) => sum + entry.bidderIds.length, 0)).toBe(bids.length);
  });
});
