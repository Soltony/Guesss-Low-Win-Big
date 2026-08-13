import prisma from './prisma';
import { getBidderSession } from './session';
import type { ShellUser } from '@/components/miniapp/mini-app-shell';
import type { Language } from './types';

/**
 * Resolves the signed-in bidder for server components. Returns null when the
 * mini-app is opened outside the super app, which is a valid browse-only state.
 */
export async function getShellUser(): Promise<ShellUser | null> {
  const session = await getBidderSession();
  if (!session) return null;

  const bidder = await prisma.bidder.findUnique({
    where: { id: session.bidderId },
    select: { id: true, phoneNumber: true, fullName: true, language: true },
  });
  if (!bidder) return null;

  const activeBids = await prisma.bid.count({
    where: { bidderId: bidder.id, status: 'ACTIVE' },
  });

  return {
    bidderId: bidder.id,
    phone: bidder.phoneNumber,
    fullName: bidder.fullName,
    language: (bidder.language === 'am' ? 'am' : 'en') as Language,
    activeBids,
    isTest: Boolean(session.isTest),
  };
}

/**
 * Bids the signed-in bidder already holds, keyed by auction. Lists need this to
 * show the remaining allowance on the inline bid form without a round trip per
 * card. Counts what the per-auction limit counts: live bids plus ones still
 * waiting on payment.
 */
export async function getBidCountsByAuction(
  bidderId: string | undefined
): Promise<Record<string, number>> {
  if (!bidderId) return {};

  const rows = await prisma.bid.groupBy({
    by: ['auctionId'],
    where: { bidderId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    _count: { _all: true },
  });

  return Object.fromEntries(rows.map((row) => [row.auctionId, row._count._all]));
}

export async function getFavoriteAuctionIds(bidderId: string | undefined) {
  if (!bidderId) return new Set<string>();
  const rows = await prisma.bidderFavorite.findMany({
    where: { bidderId },
    select: { auctionId: true },
  });
  return new Set(rows.map((r) => r.auctionId));
}
