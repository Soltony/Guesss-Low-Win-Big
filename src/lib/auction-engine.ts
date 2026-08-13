import prisma from './prisma';
import { getSetting, getSettings } from './settings';
import { createAuditLog } from './audit-log';
import { toNum } from './format';
import { createReauction, decideReauction, isWinnerValid, releaseBidCredit } from './reauction';
import type { AuctionStatus, ReauctionState, SettlementActor } from './types';

/**
 * Lowest Unique Bid Auction rules.
 *
 * A bid amount is *unique* when exactly one ACTIVE bid carries that amount
 * across the whole auction. The winner is the bidder holding the lowest such
 * amount. The lowest bid overall does NOT win if someone else matched it.
 *
 * Example (the one shown in the mini-app):
 *   1.00 ×2, 2.00 ×1, 3.00 ×2, 4.00 ×1  →  unique = {2.00, 4.00}  →  winner bids 2.00
 */

export interface RankedBid {
  bidId: string;
  bidderId: string;
  amount: number;
  rank: number;
}

/** Pure ranking function — kept side-effect free so it is directly testable. */
export function rankUniqueBids(
  bids: { id: string; bidderId: string; amount: number; createdAt: Date }[]
): RankedBid[] {
  const byAmount = new Map<string, typeof bids>();
  for (const bid of bids) {
    // Key on the fixed 2-decimal string so 2 and 2.00 are the same amount.
    const key = bid.amount.toFixed(2);
    const list = byAmount.get(key);
    if (list) list.push(bid);
    else byAmount.set(key, [bid]);
  }

  const unique: typeof bids = [];
  for (const list of byAmount.values()) {
    if (list.length === 1) unique.push(list[0]);
  }

  unique.sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    // Amounts are unique by construction, so this only breaks ties in
    // pathological data; earliest bid wins.
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return unique.map((bid, index) => ({
    bidId: bid.id,
    bidderId: bid.bidderId,
    amount: bid.amount,
    rank: index + 1,
  }));
}

/** The status an auction *should* have right now, given its window. */
export function derivedStatus(auction: {
  status: string;
  startAt: Date;
  endAt: Date;
}): AuctionStatus {
  const now = Date.now();
  const status = auction.status as AuctionStatus;

  // Terminal and pre-publication states are never derived away.
  if (
    status === 'DRAFT' ||
    status === 'PENDING_APPROVAL' ||
    status === 'CANCELLED' ||
    status === 'SETTLED'
  ) {
    return status;
  }

  if (now < auction.startAt.getTime()) return 'SCHEDULED';
  if (now >= auction.endAt.getTime()) return 'ENDED';
  return 'LIVE';
}

/**
 * Moves SCHEDULED → LIVE → ENDED for auctions whose window has moved on.
 * Cheap enough to call from list endpoints; also called by the worker.
 */
export async function syncAuctionLifecycle(): Promise<{ started: number; ended: number }> {
  const now = new Date();

  const started = await prisma.auction.updateMany({
    where: { status: 'SCHEDULED', startAt: { lte: now }, endAt: { gt: now } },
    data: { status: 'LIVE' },
  });

  const ended = await prisma.auction.updateMany({
    where: { status: { in: ['SCHEDULED', 'LIVE'] }, endAt: { lte: now } },
    data: { status: 'ENDED' },
  });

  return { started: started.count, ended: ended.count };
}

/** Voids bids whose payment never confirmed, so they cannot affect the result. */
export async function expireStalePendingBids(): Promise<number> {
  const timeoutMinutes = Number(await getSetting<number>('payments.pendingTimeoutMinutes')) || 15;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const stale = await prisma.bid.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true, bidderId: true, auctionId: true, carriedOver: true },
    take: 500,
  });
  if (stale.length === 0) return 0;

  const ids = stale.map((b) => b.id);
  await prisma.bid.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'VOID',
      voidedAt: new Date(),
      voidReason: `Payment not confirmed within ${timeoutMinutes} minutes`,
    },
  });
  await prisma.paymentTransaction.updateMany({
    where: { bidId: { in: ids }, status: 'PENDING' },
    data: { status: 'EXPIRED', failureReason: 'Bid expired before payment confirmation' },
  });

  // Carried bids confirm instantly so they rarely land here, but a voided one
  // must hand its prepaid bid back rather than burn it.
  for (const bid of stale.filter((b) => b.carriedOver)) {
    await releaseBidCredit(bid.bidderId, bid.auctionId);
  }

  return ids.length;
}

export interface SettlementOutcome {
  auctionId: string;
  settled: boolean;
  reason?: string;
  winnerBidId?: string;
  winnerBidderId?: string;
  winningAmount?: number;
  totalActiveBids: number;
  uniqueBids: number;
  rankings: RankedBid[];
  /** What settlement decided about re-running this auction. */
  reauctionState?: ReauctionState;
  reauctionReason?: string;
  /** Set when settlement opened the next round itself. */
  reauctionAuctionId?: string;
  reauctionCode?: string;
}

/**
 * Determines and persists the result of a single auction.
 *
 * Idempotent: an already-SETTLED auction is left alone unless `force` is set,
 * which is what the admin "re-settle" action uses after a dispute.
 */
export async function settleAuction(
  auctionId: string,
  actor: SettlementActor = { id: 'SYSTEM', name: 'System' },
  options: { force?: boolean; skipReauction?: boolean } = {}
): Promise<SettlementOutcome> {
  const settings = await getSettings();
  const runnerUpDepth = Number(settings['winners.runnerUpDepth']) || 0;
  const claimWindowHours = Number(settings['winners.claimWindowHours']) || 72;

  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction) throw new Error('Auction not found.');

  if (auction.status === 'CANCELLED') {
    return {
      auctionId,
      settled: false,
      reason: 'Auction was cancelled.',
      totalActiveBids: 0,
      uniqueBids: 0,
      rankings: [],
    };
  }
  if (auction.status === 'SETTLED' && !options.force) {
    return {
      auctionId,
      settled: false,
      reason: 'Auction is already settled.',
      totalActiveBids: 0,
      uniqueBids: 0,
      rankings: [],
    };
  }
  if (auction.endAt > new Date() && !options.force) {
    return {
      auctionId,
      settled: false,
      reason: 'Auction has not ended yet.',
      totalActiveBids: 0,
      uniqueBids: 0,
      rankings: [],
    };
  }

  const activeBids = await prisma.bid.findMany({
    where: { auctionId, status: 'ACTIVE' },
    select: { id: true, bidderId: true, amount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const rankings = rankUniqueBids(
    activeBids.map((b) => ({
      id: b.id,
      bidderId: b.bidderId,
      amount: toNum(b.amount),
      createdAt: b.createdAt,
    }))
  );

  // A ranked bid is only awarded when the round itself was a valid contest —
  // an auction may require a minimum turnout before it hands the item over.
  const validity = isWinnerValid(auction, {
    hasUniqueBid: rankings.length > 0,
    activeBidCount: activeBids.length,
  });
  const winner = validity.valid ? rankings[0] : undefined;

  const decision = decideReauction(
    auction,
    { hasUniqueBid: rankings.length > 0, activeBidCount: activeBids.length },
    { autoCreate: Boolean(settings['reauction.autoCreate']) }
  );
  // A chain never forks: once a round has spawned its successor, re-settling
  // the parent reports the result but leaves the lineage alone.
  const lineageSettled = auction.reauctionState === 'CREATED';

  const keep = runnerUpDepth > 0 ? rankings.slice(0, runnerUpDepth + 1) : rankings.slice(0, 1);
  const uniqueBidIds = new Set(rankings.map((r) => r.bidId));

  await prisma.$transaction(async (tx) => {
    // Re-settling replaces the previous snapshot entirely.
    await tx.auctionResult.deleteMany({ where: { auctionId } });
    if (options.force) {
      const previous = await tx.winner.findUnique({ where: { auctionId } });
      if (previous) {
        await tx.winner.delete({ where: { auctionId } });
        // The discarded win must stop counting for that bidder, or re-settling
        // inflates their win total every time it runs.
        if (previous.status !== 'FORFEITED' && previous.status !== 'CANCELLED') {
          await tx.bidder.update({
            where: { id: previous.bidderId },
            data: { winsCount: { decrement: 1 } },
          });
        }
      }
    }

    // Uniqueness flags become visible only now, at settlement.
    await tx.bid.updateMany({
      where: { auctionId, status: 'ACTIVE' },
      data: { isUnique: false, rankAtSettlement: null },
    });
    if (uniqueBidIds.size > 0) {
      await tx.bid.updateMany({
        where: { id: { in: Array.from(uniqueBidIds) } },
        data: { isUnique: true },
      });
      // Only the retained ranks are written back. Stamping a rank on every
      // unique bid would be thousands of round-trips inside one transaction,
      // and would hand each bidder the full ordering of the bid space.
      for (const ranked of keep) {
        await tx.bid.update({
          where: { id: ranked.bidId },
          data: { rankAtSettlement: ranked.rank },
        });
      }
    }

    if (keep.length > 0) {
      await tx.auctionResult.createMany({
        data: keep.map((r) => ({
          auctionId,
          bidId: r.bidId,
          bidderId: r.bidderId,
          amount: r.amount,
          rank: r.rank,
        })),
      });
    }

    if (winner) {
      const existing = await tx.winner.findUnique({ where: { auctionId } });
      const claimDeadline = new Date(Date.now() + claimWindowHours * 60 * 60 * 1000);
      if (!existing) {
        await tx.winner.create({
          data: {
            auctionId,
            bidId: winner.bidId,
            bidderId: winner.bidderId,
            amount: winner.amount,
            status: 'PENDING_CLAIM',
            claimDeadline,
          },
        });
        await tx.bidder.update({
          where: { id: winner.bidderId },
          data: { winsCount: { increment: 1 } },
        });
      }
    }

    await tx.auction.update({
      where: { id: auctionId },
      data: {
        status: 'SETTLED',
        settledAt: new Date(),
        settledById: actor.id === 'SYSTEM' ? null : actor.id,
        winnerBidId: winner?.bidId ?? null,
        ...(lineageSettled
          ? {}
          : { reauctionState: decision.state, reauctionReason: decision.reason }),
      },
    });
  });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    actorType: actor.id === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
    action: options.force ? 'AUCTION_RESETTLED' : 'AUCTION_SETTLED',
    entity: 'Auction',
    entityId: auctionId,
    details: {
      totalActiveBids: activeBids.length,
      uniqueBids: rankings.length,
      winnerBidId: winner?.bidId ?? null,
      winningAmount: winner?.amount ?? null,
      topRanks: keep.slice(0, 5),
      reauctionState: lineageSettled ? 'CREATED' : decision.state,
      reauctionReason: lineageSettled ? undefined : decision.reason,
    },
  });

  // Opening the next round is deliberately outside the settlement transaction:
  // the result is final either way, and a failure here leaves the auction
  // flagged PENDING for an operator rather than unsettled.
  let reauctionState: ReauctionState = lineageSettled ? 'CREATED' : decision.state;
  let reauctionAuctionId: string | undefined;
  let reauctionCode: string | undefined;

  if (!lineageSettled && decision.shouldCreate && !options.skipReauction) {
    try {
      const created = await createReauction(auctionId, actor, { reason: decision.reason });
      if (created.created) {
        reauctionState = 'CREATED';
        reauctionAuctionId = created.auctionId;
        reauctionCode = created.code;
      } else {
        console.error('[auction-engine] re-auction not created', auctionId, created.reason);
      }
    } catch (error) {
      console.error('[auction-engine] re-auction failed', auctionId, error);
    }
  }

  return {
    auctionId,
    settled: true,
    winnerBidId: winner?.bidId,
    winnerBidderId: winner?.bidderId,
    winningAmount: winner?.amount,
    totalActiveBids: activeBids.length,
    uniqueBids: rankings.length,
    rankings: keep,
    reason: validity.valid ? undefined : validity.reason,
    reauctionState,
    reauctionReason: lineageSettled ? undefined : decision.reason,
    reauctionAuctionId,
    reauctionCode,
  };
}

/** Settles every ended auction that is past its grace period. */
export async function autoSettleDueAuctions(): Promise<SettlementOutcome[]> {
  const settings = await getSettings();
  if (!settings['winners.autoSettle']) return [];

  const graceMinutes = Number(settings['winners.settleGraceMinutes']) || 0;
  const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);

  const due = await prisma.auction.findMany({
    where: { status: 'ENDED', endAt: { lte: cutoff } },
    select: { id: true },
    take: 50,
  });

  const outcomes: SettlementOutcome[] = [];
  for (const auction of due) {
    try {
      outcomes.push(await settleAuction(auction.id));
    } catch (error) {
      console.error('[auction-engine] settlement failed', auction.id, error);
    }
  }
  return outcomes;
}

/** Promotes the next-ranked unique bid after a winner forfeits. */
export async function promoteRunnerUp(
  auctionId: string,
  actor: SettlementActor
): Promise<{
  promoted: boolean;
  reason?: string;
  bidderId?: string;
  amount?: number;
  reauctionState?: ReauctionState;
  reauctionCode?: string;
}> {
  const claimWindowHours = Number(await getSetting<number>('winners.claimWindowHours')) || 72;

  const current = await prisma.winner.findUnique({ where: { auctionId } });
  if (!current) return { promoted: false, reason: 'This auction has no recorded winner.' };
  if (current.status !== 'FORFEITED') {
    return { promoted: false, reason: 'The current winner has not forfeited.' };
  }

  const currentResult = await prisma.auctionResult.findUnique({
    where: { bidId: current.bidId },
  });
  const nextRank = (currentResult?.rank ?? 1) + 1;

  const next = await prisma.auctionResult.findUnique({
    where: { auctionId_rank: { auctionId, rank: nextRank } },
  });
  if (!next) {
    // A forfeited winner with nobody behind them leaves the item unawarded,
    // which is the same "no valid winner" the re-auction rules exist for.
    const fallback = await flagForReauction(
      auctionId,
      'The winner forfeited and no runner-up is available.',
      actor
    );
    return {
      promoted: false,
      reason: 'No runner-up is available for this auction.',
      ...fallback,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.winner.delete({ where: { auctionId } });
    await tx.winner.create({
      data: {
        auctionId,
        bidId: next.bidId,
        bidderId: next.bidderId,
        amount: next.amount,
        status: 'PENDING_CLAIM',
        claimDeadline: new Date(Date.now() + claimWindowHours * 60 * 60 * 1000),
      },
    });
    await tx.auction.update({ where: { id: auctionId }, data: { winnerBidId: next.bidId } });
    await tx.bidder.update({
      where: { id: next.bidderId },
      data: { winsCount: { increment: 1 } },
    });
  });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'WINNER_RUNNER_UP_PROMOTED',
    entity: 'Auction',
    entityId: auctionId,
    details: { fromBidId: current.bidId, toBidId: next.bidId, rank: next.rank },
  });

  return { promoted: true, bidderId: next.bidderId, amount: toNum(next.amount) };
}

/**
 * Marks an already-settled auction as needing a re-run, and opens the round
 * when automatic creation is on. Used by paths that discover "no valid winner"
 * after settlement — a forfeit with no runner-up left, for instance.
 */
export async function flagForReauction(
  auctionId: string,
  reason: string,
  actor: SettlementActor
): Promise<{ reauctionState?: ReauctionState; reauctionCode?: string }> {
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction) return {};
  if (auction.reauctionState === 'CREATED') return { reauctionState: 'CREATED' };

  const settings = await getSettings();
  const decision = decideReauction(
    auction,
    // The round is being re-opened because the award failed, not because the
    // bids were thin, so only the round-limit and eligibility rules apply.
    { hasUniqueBid: false, activeBidCount: auction.bidCount },
    { autoCreate: Boolean(settings['reauction.autoCreate']) }
  );

  await prisma.auction.update({
    where: { id: auctionId },
    data: { reauctionState: decision.state, reauctionReason: reason },
  });

  if (!decision.shouldCreate) return { reauctionState: decision.state };

  try {
    const created = await createReauction(auctionId, actor, { reason });
    if (created.created) return { reauctionState: 'CREATED', reauctionCode: created.code };
  } catch (error) {
    console.error('[auction-engine] re-auction after forfeit failed', auctionId, error);
  }
  return { reauctionState: decision.state };
}

/** Recomputes the denormalized bid counters on an auction. */
export async function refreshAuctionCounters(auctionId: string) {
  const [bidCount, bidders] = await Promise.all([
    prisma.bid.count({ where: { auctionId, status: 'ACTIVE' } }),
    prisma.bid.findMany({
      where: { auctionId, status: 'ACTIVE' },
      select: { bidderId: true },
      distinct: ['bidderId'],
    }),
  ]);

  await prisma.auction.update({
    where: { id: auctionId },
    data: { bidCount, bidderCount: bidders.length },
  });

  return { bidCount, bidderCount: bidders.length };
}

/** Whether a bidder may currently see the unique/taken status of their own bids. */
export async function isRevealAllowed(auction: {
  status: string;
  endAt: Date;
}): Promise<boolean> {
  if (auction.status === 'SETTLED' || auction.status === 'ENDED') return true;

  const settings = await getSettings();
  const policy = String(settings['reveal.policy'] || 'END_ONLY');
  if (policy === 'LIVE') return true;
  if (policy === 'LAST_WINDOW') {
    const windowMinutes = Number(settings['reveal.windowMinutes']) || 60;
    return auction.endAt.getTime() - Date.now() <= windowMinutes * 60 * 1000;
  }
  return false;
}
