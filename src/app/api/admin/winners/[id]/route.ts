import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { promoteRunnerUp } from '@/lib/auction-engine';
import { notify } from '@/lib/notifications';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Winner fulfilment workflow:
 *   PENDING_CLAIM → CLAIMED (by the bidder) → VERIFIED → FULFILLED
 * or PENDING_CLAIM/CLAIMED → FORFEITED, after which a runner-up can be promoted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('winners', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;
  const action = String(body?.action || '');

  const winner = await prisma.winner.findUnique({
    where: { id },
    include: {
      bidder: { select: { id: true, phoneNumber: true, language: true } },
      auction: { select: { id: true, code: true, title: true, currency: true } },
    },
  });
  if (!winner) return jsonError('Winner record not found', 404);

  switch (action) {
    case 'verify': {
      if (winner.status !== 'CLAIMED') {
        return jsonError('Only a claimed prize can be verified.', 409);
      }
      await prisma.winner.update({
        where: { id },
        data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: user.id },
      });
      break;
    }

    case 'fulfill': {
      if (!['CLAIMED', 'VERIFIED'].includes(winner.status)) {
        return jsonError('The prize must be claimed before it can be marked delivered.', 409);
      }
      await prisma.winner.update({
        where: { id },
        data: {
          status: 'FULFILLED',
          fulfilledAt: new Date(),
          fulfilledById: user.id,
          fulfillmentRef: body?.fulfillmentRef ? String(body.fulfillmentRef) : undefined,
        },
      });

      await notify({
        code: 'PRIZE_FULFILLED',
        recipient: winner.bidder.phoneNumber,
        language: winner.bidder.language === 'am' ? 'am' : 'en',
        bidderId: winner.bidderId,
        auctionId: winner.auctionId,
        vars: { code: winner.auction.code, title: winner.auction.title },
      });
      break;
    }

    case 'forfeit': {
      const reason = String(body?.reason || '').trim();
      if (!reason) return jsonError('A forfeiture reason is required.', 400);
      if (winner.status === 'FULFILLED') {
        return jsonError('A delivered prize cannot be forfeited.', 409);
      }

      await prisma.$transaction(async (tx) => {
        await tx.winner.update({
          where: { id },
          data: { status: 'FORFEITED', forfeitedReason: reason },
        });
        // The win no longer counts toward the bidder's record.
        await tx.bidder.update({
          where: { id: winner.bidderId },
          data: { winsCount: { decrement: 1 } },
        });
      });
      break;
    }

    case 'promote': {
      const guardApprove = await requirePermission('winners', 'approve');
      if (isGuardFailure(guardApprove)) return guardApprove.response;

      const result = await promoteRunnerUp(winner.auctionId, {
        id: user.id,
        name: user.fullName,
      });

      // Running out of runner-ups is not a failure when the re-auction rules
      // pick the auction up instead — the operator needs to hear that, not a
      // 409 that hides the round that was just opened.
      if (!result.promoted && result.reauctionState === 'CREATED') {
        return NextResponse.json({
          ok: true,
          promoted: false,
          reauctionCode: result.reauctionCode,
          message: `No runner-up was available, so the auction was re-auctioned as ${result.reauctionCode}.`,
        });
      }
      if (!result.promoted && result.reauctionState === 'PENDING') {
        return NextResponse.json({
          ok: true,
          promoted: false,
          message: 'No runner-up was available. The auction is flagged for re-auction.',
        });
      }
      if (!result.promoted) return jsonError(result.reason || 'Could not promote a runner-up.', 409);

      const promoted = await prisma.winner.findUnique({
        where: { auctionId: winner.auctionId },
        include: { bidder: { select: { phoneNumber: true, language: true } } },
      });

      if (promoted) {
        await notify({
          code: 'WINNER_ANNOUNCED',
          recipient: promoted.bidder.phoneNumber,
          language: promoted.bidder.language === 'am' ? 'am' : 'en',
          bidderId: promoted.bidderId,
          auctionId: winner.auctionId,
          vars: {
            title: winner.auction.title,
            code: winner.auction.code,
            amount: toNum(promoted.amount).toFixed(2),
            currency: winner.auction.currency,
            deadline: promoted.claimDeadline?.toLocaleString('en-GB') ?? '',
          },
        });
      }

      return NextResponse.json({ ok: true, promoted: true, amount: result.amount });
    }

    case 'remind': {
      if (winner.status !== 'PENDING_CLAIM') {
        return jsonError('Reminders are only sent for unclaimed prizes.', 409);
      }
      const result = await notify({
        code: 'WINNER_REMINDER',
        recipient: winner.bidder.phoneNumber,
        language: winner.bidder.language === 'am' ? 'am' : 'en',
        bidderId: winner.bidderId,
        auctionId: winner.auctionId,
        vars: {
          code: winner.auction.code,
          deadline: winner.claimDeadline?.toLocaleString('en-GB') ?? '',
        },
      });
      return NextResponse.json({ ok: result.sent, message: result.reason });
    }

    default:
      return jsonError(`Unsupported action: ${action || '(none)'}`, 400);
  }

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: `WINNER_${action.toUpperCase()}`,
    entity: 'Winner',
    entityId: id,
    details: {
      auctionCode: winner.auction.code,
      bidder: winner.bidder.phoneNumber,
      reason: body?.reason,
      fulfillmentRef: body?.fulfillmentRef,
    },
  });

  return NextResponse.json({ ok: true });
}
