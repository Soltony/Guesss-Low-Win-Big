import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession } from '@/lib/session';
import { jsonError } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { firstImage, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const wins = await prisma.winner.findMany({
    where: { bidderId: session.bidderId },
    orderBy: { createdAt: 'desc' },
    include: {
      auction: {
        select: {
          id: true,
          code: true,
          title: true,
          currency: true,
          settledAt: true,
          item: { select: { images: true, retailPrice: true } },
        },
      },
    },
  });

  return NextResponse.json({
    wins: wins.map((win) => ({
      id: win.id,
      auctionId: win.auctionId,
      auctionCode: win.auction.code,
      title: win.auction.title,
      imageUrl: firstImage(win.auction.item.images),
      retailPrice: toNum(win.auction.item.retailPrice),
      amount: toNum(win.amount),
      currency: win.auction.currency,
      status: win.status,
      claimDeadline: win.claimDeadline?.toISOString() ?? null,
      claimedAt: win.claimedAt?.toISOString() ?? null,
      fulfilledAt: win.fulfilledAt?.toISOString() ?? null,
      settledAt: win.auction.settledAt?.toISOString() ?? null,
      deliveryName: win.deliveryName,
      deliveryPhone: win.deliveryPhone,
      deliveryAddress: win.deliveryAddress,
    })),
  });
}

/** Bidder submits their delivery details to claim a prize. */
export async function POST(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await req.json().catch(() => ({}));
  const winnerId = String(body?.winnerId || '');
  const deliveryName = String(body?.deliveryName || '').trim();
  const deliveryPhone = String(body?.deliveryPhone || '').trim();
  const deliveryAddress = String(body?.deliveryAddress || '').trim();
  const deliveryNote = String(body?.deliveryNote || '').trim();

  if (!winnerId) return jsonError('Win reference is required.', 400);
  if (!deliveryName) return jsonError('Please enter the name of the person collecting.', 400);
  if (!deliveryPhone) return jsonError('Please enter a contact phone number.', 400);
  if (!deliveryAddress) return jsonError('Please enter a delivery address.', 400);

  const winner = await prisma.winner.findUnique({ where: { id: winnerId } });
  if (!winner || winner.bidderId !== session.bidderId) return jsonError('Win not found.', 404);

  if (winner.status === 'FORFEITED' || winner.status === 'CANCELLED') {
    return jsonError('This prize can no longer be claimed.', 409);
  }
  if (winner.status !== 'PENDING_CLAIM') {
    return jsonError('This prize has already been claimed.', 409);
  }
  if (winner.claimDeadline && winner.claimDeadline < new Date()) {
    return jsonError('The claim window for this prize has closed.', 409);
  }

  const updated = await prisma.winner.update({
    where: { id: winnerId },
    data: {
      status: 'CLAIMED',
      claimedAt: new Date(),
      deliveryName: deliveryName.slice(0, 120),
      deliveryPhone: deliveryPhone.slice(0, 40),
      deliveryAddress: deliveryAddress.slice(0, 1000),
      deliveryNote: deliveryNote.slice(0, 1000) || undefined,
    },
  });

  await createAuditLog({
    actorId: session.phone,
    actorType: 'BIDDER',
    action: 'PRIZE_CLAIMED',
    entity: 'Winner',
    entityId: winnerId,
    details: { auctionId: winner.auctionId },
  });

  return NextResponse.json({ id: updated.id, status: updated.status });
}
