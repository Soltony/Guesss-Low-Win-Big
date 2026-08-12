import prisma from './prisma';
import { toNum } from './format';

/** Aggregated figures for the admin dashboard. */
export async function getDashboardMetrics() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last30 = new Date(startOfToday.getTime() - 29 * 86_400_000);

  const [
    liveAuctions,
    scheduledAuctions,
    endedUnsettled,
    pendingApprovals,
    activeBidsToday,
    activeBidsTotal,
    bidders,
    newBiddersToday,
    pendingClaims,
    pendingPayments,
    failedPayments,
    feeRevenueTotal,
    feeRevenueToday,
  ] = await Promise.all([
    prisma.auction.count({ where: { status: 'LIVE' } }),
    prisma.auction.count({ where: { status: 'SCHEDULED' } }),
    prisma.auction.count({ where: { status: 'ENDED' } }),
    prisma.pendingChange.count({ where: { status: 'PENDING' } }),
    prisma.bid.count({ where: { status: 'ACTIVE', confirmedAt: { gte: startOfToday } } }),
    prisma.bid.count({ where: { status: 'ACTIVE' } }),
    prisma.bidder.count(),
    prisma.bidder.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.winner.count({ where: { status: { in: ['PENDING_CLAIM', 'CLAIMED', 'VERIFIED'] } } }),
    prisma.paymentTransaction.count({ where: { status: 'PENDING' } }),
    prisma.paymentTransaction.count({
      where: { status: { in: ['FAILED', 'REVERSED'] }, createdAt: { gte: last30 } },
    }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS' },
      _sum: { amount: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', updatedAt: { gte: startOfToday } },
      _sum: { amount: true },
    }),
  ]);

  return {
    liveAuctions,
    scheduledAuctions,
    endedUnsettled,
    pendingApprovals,
    activeBidsToday,
    activeBidsTotal,
    bidders,
    newBiddersToday,
    pendingClaims,
    pendingPayments,
    failedPayments,
    feeRevenueTotal: toNum(feeRevenueTotal._sum.amount),
    feeRevenueToday: toNum(feeRevenueToday._sum.amount),
  };
}

/** Daily bid volume and fee revenue for the last N days. */
export async function getDailyActivity(days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const [bids, payments] = await Promise.all([
    prisma.bid.findMany({
      where: { status: 'ACTIVE', confirmedAt: { gte: start } },
      select: { confirmedAt: true, feeAmount: true },
    }),
    prisma.paymentTransaction.findMany({
      where: { status: 'SUCCESS', updatedAt: { gte: start } },
      select: { updatedAt: true, amount: true },
    }),
  ]);

  const buckets = new Map<string, { date: string; bids: number; revenue: number }>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, { date: key, bids: 0, revenue: 0 });
  }

  for (const bid of bids) {
    if (!bid.confirmedAt) continue;
    const key = bid.confirmedAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.bids += 1;
  }

  for (const payment of payments) {
    const key = payment.updatedAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.revenue += toNum(payment.amount);
  }

  return Array.from(buckets.values());
}

/** Top auctions by confirmed bid volume. */
export async function getTopAuctions(take = 5) {
  const auctions = await prisma.auction.findMany({
    where: { status: { in: ['LIVE', 'ENDED', 'SETTLED'] } },
    orderBy: { bidCount: 'desc' },
    take,
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      bidCount: true,
      bidderCount: true,
      bidFee: true,
      endAt: true,
    },
  });

  return auctions.map((a) => ({
    ...a,
    bidFee: toNum(a.bidFee),
    endAt: a.endAt.toISOString(),
    estimatedRevenue: toNum(a.bidFee) * a.bidCount,
  }));
}
