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
  };
}

export async function getFavoriteAuctionIds(bidderId: string | undefined) {
  if (!bidderId) return new Set<string>();
  const rows = await prisma.bidderFavorite.findMany({
    where: { bidderId },
    select: { auctionId: true },
  });
  return new Set(rows.map((r) => r.auctionId));
}
