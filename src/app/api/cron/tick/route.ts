import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  autoSettleDueAuctions,
  expireStalePendingBids,
  syncAuctionLifecycle,
} from '@/lib/auction-engine';
import { getSettings } from '@/lib/settings';
import { notify } from '@/lib/notifications';
import { createAuditLog } from '@/lib/audit-log';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Scheduled maintenance tick. Point a cron job (or the platform scheduler) at
 * this every minute with the shared secret:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://host/api/cron/tick
 *
 * It advances auction lifecycles, voids unpaid bids, settles ended auctions
 * and sends winner notifications. Every step is idempotent, so a missed or
 * duplicated tick is harmless.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const startedAt = Date.now();

  const lifecycle = await syncAuctionLifecycle();
  const expired = await expireStalePendingBids();
  const settlements = await autoSettleDueAuctions();

  let winnersNotified = 0;
  const settings = await getSettings();

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

  const summary = {
    startedLive: lifecycle.started,
    ended: lifecycle.ended,
    expiredBids: expired,
    settled: settlements.filter((s) => s.settled).length,
    reauctionsCreated: settlements.filter((s) => s.reauctionAuctionId).length,
    reauctionsPending: settlements.filter((s) => s.reauctionState === 'PENDING').length,
    winnersNotified,
    endingSoonNotified,
    durationMs: Date.now() - startedAt,
  };

  await createAuditLog({
    actorId: 'SYSTEM',
    actorType: 'SYSTEM',
    action: 'CRON_TICK',
    details: summary,
  });

  return NextResponse.json(summary);
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

export async function GET(req: NextRequest) {
  return POST(req);
}
