import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession, deleteBidderSession } from '@/lib/session';
import { jsonError } from '@/lib/api';
import { toNum } from '@/lib/format';
import { isLanguage } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const bidder = await prisma.bidder.findUnique({
    where: { id: session.bidderId },
    select: {
      id: true,
      phoneNumber: true,
      fullName: true,
      language: true,
      status: true,
      totalBids: true,
      totalSpent: true,
      winsCount: true,
      createdAt: true,
    },
  });
  if (!bidder) return jsonError('Bidder not found', 404);

  const [activeAuctions, pendingWins] = await Promise.all([
    prisma.bid.findMany({
      where: { bidderId: bidder.id, status: 'ACTIVE' },
      select: { auctionId: true },
      distinct: ['auctionId'],
    }),
    prisma.winner.count({
      where: { bidderId: bidder.id, status: { in: ['PENDING_CLAIM', 'CLAIMED'] } },
    }),
  ]);

  return NextResponse.json({
    ...bidder,
    totalSpent: toNum(bidder.totalSpent),
    createdAt: bidder.createdAt.toISOString(),
    auctionsEntered: activeAuctions.length,
    pendingWins,
  });
}

/** Updates the bidder's own profile — name and language only. */
export async function PATCH(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await req.json().catch(() => ({}));
  const data: { fullName?: string; language?: string } = {};

  if (typeof body.fullName === 'string') {
    const name = body.fullName.trim();
    if (name.length > 120) return jsonError('Name is too long.', 400);
    data.fullName = name || undefined;
  }
  if (body.language !== undefined) {
    if (!isLanguage(body.language)) return jsonError('Unsupported language.', 400);
    data.language = body.language;
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  const updated = await prisma.bidder.update({
    where: { id: session.bidderId },
    data,
    select: { id: true, fullName: true, language: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE() {
  await deleteBidderSession();
  return NextResponse.json({ ok: true });
}
