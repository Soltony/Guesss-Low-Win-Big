import type { ReauctionState } from './types';

/**
 * Re-auction rules, stated as pure functions.
 *
 * Kept free of any database import so the same rule that decides a settlement
 * on the server also renders the fee explanation in the mini-app, rather than
 * the two drifting apart. `src/lib/reauction.ts` holds everything that touches
 * the database and re-exports these.
 */

/** The subset of an auction the re-auction rules actually read. */
export interface ReauctionConfig {
  reauctionEnabled: boolean;
  reauctionRound: number;
  maxReauctionRounds: number;
  reauctionAllowNewBidders: boolean;
  reauctionAllowPreviousBidders: boolean;
  reauctionMinBids: number;
}

export interface RoundOutcome {
  /** At least one amount was bid exactly once. */
  hasUniqueBid: boolean;
  /** Confirmed (ACTIVE) bids in the round. */
  activeBidCount: number;
}

/**
 * Whether the round produced a winner worth awarding.
 *
 * A lowest-unique auction with no unique amount has no winner at all. On top of
 * that an auction may set a participation floor: a round that closes with a
 * handful of bids is not a real contest, so its "winner" is not awarded and the
 * round is re-run. The floor only applies when re-auction is enabled — without
 * a next round it would strand the item with nobody to award it to.
 */
export function isWinnerValid(
  auction: Pick<ReauctionConfig, 'reauctionEnabled' | 'reauctionMinBids'>,
  outcome: RoundOutcome
): { valid: boolean; reason?: string } {
  if (!outcome.hasUniqueBid) {
    return { valid: false, reason: 'No unique bid was placed — the auction has no winner.' };
  }

  const floor = auction.reauctionEnabled ? auction.reauctionMinBids : 0;
  if (floor > 0 && outcome.activeBidCount < floor) {
    return {
      valid: false,
      reason: `Only ${outcome.activeBidCount} confirmed bid(s) were placed; ${floor} are required for a valid result.`,
    };
  }

  return { valid: true };
}

export interface ReauctionDecision {
  /** Where the settled auction lands once the decision is applied. */
  state: Exclude<ReauctionState, 'CREATED' | 'NONE'>;
  reason: string;
  /** A new round should be opened right now. */
  shouldCreate: boolean;
}

/**
 * What to do with an auction once settlement knows whether it has a winner.
 * `PENDING` means "eligible, but waiting for an operator" — either because
 * automatic creation is off, or because creating it failed.
 */
export function decideReauction(
  auction: ReauctionConfig,
  outcome: RoundOutcome,
  options: { autoCreate: boolean }
): ReauctionDecision {
  const validity = isWinnerValid(auction, outcome);
  if (validity.valid) {
    return {
      state: 'NOT_NEEDED',
      reason: 'The auction settled with a valid winner.',
      shouldCreate: false,
    };
  }

  const because = validity.reason ?? 'The auction has no valid winner.';

  if (!auction.reauctionEnabled) {
    return {
      state: 'DISABLED',
      reason: `${because} Re-auction is switched off.`,
      shouldCreate: false,
    };
  }
  if (auction.reauctionRound >= auction.maxReauctionRounds) {
    return {
      state: 'EXHAUSTED',
      reason: `${because} All ${auction.maxReauctionRounds} re-auction round(s) have been used.`,
      shouldCreate: false,
    };
  }
  if (!auction.reauctionAllowNewBidders && !auction.reauctionAllowPreviousBidders) {
    return {
      state: 'BLOCKED',
      reason: `${because} The rules admit neither new nor previous bidders, so a re-auction would have nobody to bid in it.`,
      shouldCreate: false,
    };
  }

  return { state: 'PENDING', reason: because, shouldCreate: options.autoCreate };
}

/**
 * Splits the bids placed in one round into the ones a bidder has already paid
 * for and the ones that carry a new fee. This is the rule that keeps a chain of
 * re-auctions from charging twice: 5 paid, 8 placed → 3 charged.
 */
export function splitCarriedBids(
  placed: number,
  carriedForward: number
): { free: number; charged: number } {
  const free = Math.min(Math.max(0, placed), Math.max(0, carriedForward));
  return { free, charged: Math.max(0, placed - free) };
}
