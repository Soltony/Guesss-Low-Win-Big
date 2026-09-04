import prisma from './prisma';
import {
  autoSettleDueAuctions,
  expireStalePendingBids,
  refreshLiveAuctionCounters,
  syncAuctionLifecycle,
} from './auction-engine';
import { getSettings } from './settings';
import { notify } from './notifications';
import { createAuditLog } from './audit-log';
import { toNum } from './format';

/**
 * The scheduled maintenance pass.
 *
 * Advances auction lifecycles, voids unpaid bids, settles ended auctions, opens
 * re-auction rounds and sends the messages each of those owes. Every step is
 * idempotent, so a missed or duplicated pass is harmless.
 *
 * Three things drive it, deliberately overlapping:
 *
 *   - `POST /api/cron/tick` — the documented external cron, once a minute.
 *   - `npm run run:worker`  — an in-process loop for deployments with no cron.
 *   - the read paths        — `touchAuctionLifecycle()` below.
 *
 * The last one exists because settlement used to depend *solely* on the cron.
 * When nothing was scheduled, auctions reached ENDED (the read paths already
 * synced lifecycles) and then stayed there forever, with winners never picked
 * and re-auctions never opened. A platform must not need an external scheduler
 * to award the prize it took bid fees for, so the read paths now nudge the same
 * pass along in the background.
 */

export type MaintenanceTrigger = 'cron' | 'worker' | 'lazy';

export interface MaintenanceSummary {
  trigger: MaintenanceTrigger;
  startedLive: number;
  ended: number;
  expiredBids: number;
  settled: number;
  reauctionsCreated: number;
  reauctionsPending: number;
  winnersNotified: number;
  endingSoonNotified: number;
  /** Live auctions whose displayed bid/bidder counts were recomputed. */
  countersRefreshed: number;
  durationMs: number;
}

/** Whether a pass actually changed anything worth recording. */
function didSomething(summary: MaintenanceSummary): boolean {
  return (
    summary.startedLive > 0 ||
    summary.ended > 0 ||
    summary.expiredBids > 0 ||
    summary.settled > 0 ||
    summary.winnersNotified > 0 ||
    summary.endingSoonNotified > 0
  );
}

export async function runMaintenance(
  trigger: MaintenanceTrigger = 'cron'
): Promise<MaintenanceSummary> {
  const startedAt = Date.now();

  const lifecycle = await syncAuctionLifecycle();
  const expired = await expireStalePendingBids();
  const settlements = await autoSettleDueAuctions();
  // Bidding no longer maintains the auction counters — one shared row per bid
  // was the throughput ceiling — so they are recomputed here instead. After
  // settlement, so an auction that just settled keeps the exact figures
  // settlement wrote rather than having them recounted a second time.
  const countersRefreshed = await refreshLiveAuctionCounters();

  const settings = await getSettings();
  let winnersNotified = 0;

  if (settings['notifications.onWin']) {
    for (const outcome of settlements) {
      if (!outcome.settled || !outcome.winnerBidderId) continue;

      const winner = await prisma.winner.findUnique({
        where: { auctionId: outcome.auctionId },
        include: {
          bidder: { select: { phoneNumber: true, language: true } },
          auction: { select: { code: true, title: true, currency: true } },
        },
      });
      if (!winner) continue;

      const result = await notify({
        code: 'WINNER_ANNOUNCED',
        recipient: winner.bidder.phoneNumber,
        language: winner.bidder.language === 'am' ? 'am' : 'en',
        bidderId: winner.bidderId,
        auctionId: winner.auctionId,
        vars: {
          title: winner.auction.title,
          code: winner.auction.code,
          amount: toNum(winner.amount).toFixed(2),
          currency: winner.auction.currency,
          deadline: winner.claimDeadline?.toLocaleString('en-GB') ?? '',
        },
      });
      if (result.sent) winnersNotified += 1;
    }
  }

  const endingSoonNotified = settings['notifications.onAuctionEnding']
    ? await notifyEndingSoon()
    : 0;

  const summary: MaintenanceSummary = {
    trigger,
    startedLive: lifecycle.started,
    ended: lifecycle.ended,
    expiredBids: expired,
    settled: settlements.filter((s) => s.settled).length,
    reauctionsCreated: settlements.filter((s) => s.reauctionAuctionId).length,
    reauctionsPending: settlements.filter((s) => s.reauctionState === 'PENDING').length,
    winnersNotified,
    endingSoonNotified,
    countersRefreshed,
    durationMs: Date.now() - startedAt,
  };

  // A pass runs at least once a minute and usually has nothing to do. Logging
  // every one of them would bury the entries an auditor actually needs under
  // ~1400 empty rows a day, so only passes that changed something are recorded.
  // The caller still gets the full summary either way.
  if (didSomething(summary)) {
    await createAuditLog({
      actorId: 'SYSTEM',
      actorType: 'SYSTEM',
      action: 'CRON_TICK',
      details: summary,
    });
  }

  return summary;
}

/** One reminder per bidder per auction, sent as the closing window opens. */
async function notifyEndingSoon(): Promise<number> {
  const windowStart = new Date(Date.now() + 55 * 60 * 1000);
  const windowEnd = new Date(Date.now() + 65 * 60 * 1000);

  const auctions = await prisma.auction.findMany({
    where: { status: 'LIVE', endAt: { gte: windowStart, lte: windowEnd } },
    select: { id: true, code: true, title: true },
  });

  let sent = 0;
  for (const auction of auctions) {
    const bids = await prisma.bid.findMany({
      where: { auctionId: auction.id, status: 'ACTIVE' },
      select: { bidderId: true },
      distinct: ['bidderId'],
    });

    for (const { bidderId } of bids) {
      const alreadySent = await prisma.notificationLog.count({
        where: { templateCode: 'AUCTION_ENDING', bidderId, auctionId: auction.id },
      });
      if (alreadySent > 0) continue;

      const bidder = await prisma.bidder.findUnique({
        where: { id: bidderId },
        select: { phoneNumber: true, language: true },
      });
      if (!bidder) continue;

      const result = await notify({
        code: 'AUCTION_ENDING',
        recipient: bidder.phoneNumber,
        language: bidder.language === 'am' ? 'am' : 'en',
        bidderId,
        auctionId: auction.id,
        vars: { code: auction.code, title: auction.title, hours: 1 },
      });
      if (result.sent) sent += 1;
    }
  }

  return sent;
}

// --------------------------------------
// BACKGROUND PASS
// --------------------------------------

/** How long a lazily-triggered pass waits before it is willing to run again. */
const LAZY_INTERVAL_MS = 60_000;

let lastLazyRunAt = 0;
let inFlight = false;

/**
 * Runs a pass in the background, at most one at a time and at most once a
 * minute per process. Never throws and is never awaited, so a slow settlement
 * or an SMS outage cannot stall the page that triggered it.
 */
export function runMaintenanceInBackground(): void {
  if (inFlight) return;
  if (Date.now() - lastLazyRunAt < LAZY_INTERVAL_MS) return;

  inFlight = true;
  void runMaintenance('lazy')
    .catch((error) => {
      console.error('[maintenance] background pass failed', error);
    })
    .finally(() => {
      // Timed from the end of the pass, so a pass that takes longer than the
      // interval does not immediately queue the next one.
      lastLazyRunAt = Date.now();
      inFlight = false;
    });
}

/**
 * What a read path should call: brings the statuses this request is about to
 * render up to date, then nudges the rest of the pass along behind it.
 *
 * The lifecycle sync is awaited because the caller renders its result; the
 * settlement pass is not, because nobody is waiting on it.
 */
export async function touchAuctionLifecycle(): Promise<void> {
  await syncAuctionLifecycle();
  runMaintenanceInBackground();
}
