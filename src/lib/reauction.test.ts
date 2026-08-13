import { describe, expect, it } from 'vitest';
import {
  decideReauction,
  isWinnerValid,
  splitCarriedBids,
  type ReauctionConfig,
} from './reauction-rules';
import { parseReauctionConfig, type ReauctionSettings } from './reauction';

const config = (overrides: Partial<ReauctionConfig> = {}): ReauctionConfig => ({
  reauctionEnabled: true,
  reauctionRound: 0,
  maxReauctionRounds: 1,
  reauctionAllowNewBidders: true,
  reauctionAllowPreviousBidders: true,
  reauctionMinBids: 0,
  ...overrides,
});

describe('isWinnerValid', () => {
  it('accepts a round that produced a unique bid', () => {
    expect(isWinnerValid(config(), { hasUniqueBid: true, activeBidCount: 12 }).valid).toBe(true);
  });

  it('rejects a round where every amount was duplicated', () => {
    const result = isWinnerValid(config(), { hasUniqueBid: false, activeBidCount: 40 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no unique bid/i);
  });

  it('rejects a winner from a round that missed the participation floor', () => {
    const result = isWinnerValid(config({ reauctionMinBids: 25 }), {
      hasUniqueBid: true,
      activeBidCount: 4,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('25');
  });

  it('ignores the participation floor when re-auction is off', () => {
    // Without a next round, voiding the winner would strand the item with
    // nobody to award it to — so the floor only bites when a re-run can follow.
    const result = isWinnerValid(config({ reauctionEnabled: false, reauctionMinBids: 25 }), {
      hasUniqueBid: true,
      activeBidCount: 4,
    });
    expect(result.valid).toBe(true);
  });
});

describe('decideReauction', () => {
  const auto = { autoCreate: true };

  it('does nothing when the auction has a valid winner', () => {
    const decision = decideReauction(config(), { hasUniqueBid: true, activeBidCount: 9 }, auto);
    expect(decision.state).toBe('NOT_NEEDED');
    expect(decision.shouldCreate).toBe(false);
  });

  it('opens a round when there is no unique bid', () => {
    const decision = decideReauction(config(), { hasUniqueBid: false, activeBidCount: 9 }, auto);
    expect(decision.state).toBe('PENDING');
    expect(decision.shouldCreate).toBe(true);
  });

  it('only flags the auction when automatic creation is off', () => {
    const decision = decideReauction(
      config(),
      { hasUniqueBid: false, activeBidCount: 9 },
      { autoCreate: false }
    );
    expect(decision.state).toBe('PENDING');
    expect(decision.shouldCreate).toBe(false);
  });

  it('reports DISABLED when the auction opted out', () => {
    const decision = decideReauction(
      config({ reauctionEnabled: false }),
      { hasUniqueBid: false, activeBidCount: 9 },
      auto
    );
    expect(decision.state).toBe('DISABLED');
    expect(decision.shouldCreate).toBe(false);
  });

  it('stops once the configured rounds are used up', () => {
    const decision = decideReauction(
      config({ reauctionRound: 2, maxReauctionRounds: 2 }),
      { hasUniqueBid: false, activeBidCount: 9 },
      auto
    );
    expect(decision.state).toBe('EXHAUSTED');
    expect(decision.shouldCreate).toBe(false);
  });

  it('refuses a round nobody would be allowed to bid in', () => {
    const decision = decideReauction(
      config({ reauctionAllowNewBidders: false, reauctionAllowPreviousBidders: false }),
      { hasUniqueBid: false, activeBidCount: 9 },
      auto
    );
    expect(decision.state).toBe('BLOCKED');
    expect(decision.shouldCreate).toBe(false);
  });

  it('re-runs a round that fell short of the participation floor', () => {
    const decision = decideReauction(
      config({ reauctionMinBids: 50 }),
      { hasUniqueBid: true, activeBidCount: 6 },
      auto
    );
    expect(decision.state).toBe('PENDING');
    expect(decision.shouldCreate).toBe(true);
    expect(decision.reason).toContain('50');
  });
});

describe('splitCarriedBids', () => {
  it('charges only the bids beyond what was already paid for', () => {
    // The rule as stated: 5 bids paid for, 8 placed in the re-auction, 3 charged.
    expect(splitCarriedBids(8, 5)).toEqual({ free: 5, charged: 3 });
  });

  it('charges nothing while the bidder stays inside their carried balance', () => {
    expect(splitCarriedBids(3, 5)).toEqual({ free: 3, charged: 0 });
  });

  it('charges every bid when nothing carried forward', () => {
    expect(splitCarriedBids(4, 0)).toEqual({ free: 0, charged: 4 });
  });

  it('never charges twice across consecutive re-auctions', () => {
    // Round 1: 5 bids, all charged — nothing had been paid before.
    const round1 = splitCarriedBids(5, 0);
    expect(round1.charged).toBe(5);

    // Round 2: 8 bids against the 5 already paid for — 3 new charges.
    const paidAfterRound1 = round1.charged;
    const round2 = splitCarriedBids(8, paidAfterRound1);
    expect(round2).toEqual({ free: 5, charged: 3 });

    // Round 3: 10 bids against the 8 now paid for — 2 new charges. The bidder
    // has still only ever paid for the largest round they played.
    const paidAfterRound2 = paidAfterRound1 + round2.charged;
    expect(paidAfterRound2).toBe(8);
    const round3 = splitCarriedBids(10, paidAfterRound2);
    expect(round3).toEqual({ free: 8, charged: 2 });

    const totalCharged = round1.charged + round2.charged + round3.charged;
    expect(totalCharged).toBe(10);
  });

  it('holds unused credit for a later round', () => {
    // Round 2 uses only 2 of 5 carried bids; round 3 still sees all 5.
    const round2 = splitCarriedBids(2, 5);
    expect(round2).toEqual({ free: 2, charged: 0 });
    expect(splitCarriedBids(6, 5 + round2.charged)).toEqual({ free: 5, charged: 1 });
  });
});

describe('parseReauctionConfig', () => {
  const current: ReauctionSettings = {
    reauctionEnabled: false,
    maxReauctionRounds: 1,
    reauctionDurationHours: 24,
    reauctionStartDelayMinutes: 0,
    reauctionAllowNewBidders: true,
    reauctionAllowPreviousBidders: true,
    reauctionMinBids: 0,
  };

  it('keeps the current value for anything the caller omitted', () => {
    const result = parseReauctionConfig({ reauctionEnabled: true }, current);
    expect(result).toEqual({
      config: { ...current, reauctionEnabled: true },
    });
  });

  it('rejects a round limit below one', () => {
    const result = parseReauctionConfig({ maxReauctionRounds: 0 }, current);
    expect(result).toEqual({ error: expect.stringContaining('at least 1') });
  });

  it('rejects a duration that would close the round instantly', () => {
    const result = parseReauctionConfig({ reauctionDurationHours: 0 }, current);
    expect(result).toEqual({ error: expect.stringContaining('at least 1 hour') });
  });

  it('rejects a re-auction nobody could bid in', () => {
    const result = parseReauctionConfig(
      {
        reauctionEnabled: true,
        reauctionAllowNewBidders: false,
        reauctionAllowPreviousBidders: false,
      },
      current
    );
    expect(result).toEqual({ error: expect.stringContaining('nobody could bid') });
  });

  it('allows both switches off while re-auction itself is off', () => {
    const result = parseReauctionConfig(
      { reauctionAllowNewBidders: false, reauctionAllowPreviousBidders: false },
      current
    );
    expect('config' in result).toBe(true);
  });
});
