import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/** Removes one person from an auction's invited list. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; participantId: string }> }
) {
  const guard = await requirePermission('auctions', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id, participantId } = await params;

  const participant = await prisma.auctionParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, auctionId: true, phoneNumber: true },
  });
  // Checked against the auction in the URL, so a participant id from one
  // auction cannot be used to edit another's list.
  if (!participant || participant.auctionId !== id) {
    return jsonError('Participant not found on this auction.', 404);
  }

  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { status: true, code: true },
  });
  if (!auction) return jsonError('Auction not found', 404);
  if (auction.status === 'SETTLED' || auction.status === 'CANCELLED') {
    return jsonError(
      `A ${auction.status.toLowerCase()} auction's participant list cannot be changed.`,
      409
    );
  }

  await prisma.auctionParticipant.delete({ where: { id: participantId } });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUCTION_PARTICIPANT_REMOVED',
    entity: 'Auction',
    entityId: id,
    details: { code: auction.code, phoneNumber: participant.phoneNumber },
  });

  const remaining = await prisma.auctionParticipant.count({ where: { auctionId: id } });

  return NextResponse.json({ ok: true, remaining });
}
