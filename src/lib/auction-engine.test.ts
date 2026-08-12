import { describe, expect, it } from 'vitest';
import { rankUniqueBids, derivedStatus } from './auction-engine';

const at = (minutes: number) => new Date(2026, 0, 1, 12, minutes);

function bid(id: string, bidderId: string, amount: number, minute = 0) {
  return { id, bidderId, amount, createdAt: at(minute) };
}

describe('rankUniqueBids', () => {
  it('picks the lowest unique bid, not the lowest bid', () => {
    // The example shown to customers in the mini-app:
    // 1.00 x2, 2.00 x1, 3.00 x2, 4.00 x1 -> 2.00 wins.
    const ranked = rankUniqueBids([
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 3.0),
      bid('e', 'u5', 3.0),
      bid('f', 'u6', 4.0),
    ]);

    expect(ranked.map((r) => r.amount)).toEqual([2.0, 4.0]);
    expect(ranked[0].bidId).toBe('c');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it('treats 2 and 2.00 as the same amount', () => {
    const ranked = rankUniqueBids([
      bid('a', 'u1', 2),
      bid('b', 'u2', 2.0),
      bid('c', 'u3', 5.5),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].amount).toBe(5.5);
  });

  it('does not let a bidder duplicating their own amount stay unique', () => {
    const ranked = rankUniqueBids([
      bid('a', 'u1', 1.5),
      bid('b', 'u1', 1.5),
      bid('c', 'u2', 9.0),
    ]);

    expect(ranked.map((r) => r.bidId)).toEqual(['c']);
  });

  it('returns nothing when every amount is duplicated', () => {
    const ranked = rankUniqueBids([
      bid('a', 'u1', 1.0),
      bid('b', 'u2', 1.0),
      bid('c', 'u3', 2.0),
      bid('d', 'u4', 2.0),
    ]);

    expect(ranked).toEqual([]);
  });

  it('handles an empty auction', () => {
    expect(rankUniqueBids([])).toEqual([]);
  });

  it('ranks cent-level amounts in true numeric order', () => {
    // String ordering would put 10.00 before 9.99 — it must not.
    const ranked = rankUniqueBids([
      bid('a', 'u1', 10.0),
      bid('b', 'u2', 9.99),
      bid('c', 'u3', 100.0),
      bid('d', 'u4', 2.5),
    ]);

    expect(ranked.map((r) => r.amount)).toEqual([2.5, 9.99, 10.0, 100.0]);
  });

  it('breaks a tie on the earliest bid', () => {
    // Amounts are unique by construction, so this only guards against
    // pathological data reaching the sort.
    const ranked = rankUniqueBids([bid('late', 'u1', 3.0, 30), bid('early', 'u2', 1.0, 5)]);
    expect(ranked[0].bidId).toBe('early');
  });
});

describe('derivedStatus', () => {
  const hour = 3_600_000;

  it('reports SCHEDULED before the start time', () => {
    const status = derivedStatus({
      status: 'SCHEDULED',
      startAt: new Date(Date.now() + hour),
      endAt: new Date(Date.now() + 2 * hour),
    });
    expect(status).toBe('SCHEDULED');
  });

  it('promotes a scheduled auction to LIVE once it opens', () => {
    const status = derivedStatus({
      status: 'SCHEDULED',
      startAt: new Date(Date.now() - hour),
      endAt: new Date(Date.now() + hour),
    });
    expect(status).toBe('LIVE');
  });

  it('reports ENDED once the window closes', () => {
    const status = derivedStatus({
      status: 'LIVE',
      startAt: new Date(Date.now() - 2 * hour),
      endAt: new Date(Date.now() - hour),
    });
    expect(status).toBe('ENDED');
  });

  it('never derives away a terminal or pre-publication state', () => {
    const window = {
      startAt: new Date(Date.now() - 2 * hour),
      endAt: new Date(Date.now() - hour),
    };
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'SETTLED'] as const) {
      expect(derivedStatus({ status, ...window })).toBe(status);
    }
  });
});
