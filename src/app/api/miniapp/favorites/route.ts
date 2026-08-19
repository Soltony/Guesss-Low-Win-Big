import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession } from '@/lib/session';
import { jsonError, readJsonBody } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const favorites = await prisma.bidderFavorite.findMany({
    where: { bidderId: session.bidderId },
    select: { auctionId: true },
  });

  return NextResponse.json({ auctionIds: favorites.map((f) => f.auctionId) });
}

/** Toggles a watchlist entry. */
export async function POST(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const auctionId = String(body?.auctionId || '');
  if (!auctionId) return jsonError('Auction is required.', 400);

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true },
  });
  if (!auction) return jsonError('Auction not found.', 404);

  const existing = await prisma.bidderFavorite.findUnique({
    where: { bidderId_auctionId: { bidderId: session.bidderId, auctionId } },
  });

  if (existing) {
    await prisma.bidderFavorite.delete({ where: { id: existing.id } });
    return NextResponse.json({ favorited: false });
  }

  await prisma.bidderFavorite.create({ data: { bidderId: session.bidderId, auctionId } });
  return NextResponse.json({ favorited: true });
}
