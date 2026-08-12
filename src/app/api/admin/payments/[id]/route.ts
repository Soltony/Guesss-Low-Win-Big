import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { confirmBid, failBid } from '@/lib/bidding';

export const dynamic = 'force-dynamic';

/**
 * Manual reconciliation for payments the gateway never resolved.
 *
 * Confirming requires `approve` rather than `update`: it credits a bid that no
 * callback ever verified, so it must sit with a senior operator.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  const note = String(body?.note || '').trim();

  const { id } = await params;
  const payment = await prisma.paymentTransaction.findUnique({
    where: { id },
    include: { bid: { select: { id: true, status: true } } },
  });
  if (!payment) return jsonError('Payment not found', 404);

  if (!note) return jsonError('A resolution note is required.', 400);

  switch (action) {
    case 'confirm': {
      const guard = await requirePermission('payments', 'approve');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      if (payment.status === 'SUCCESS') {
        return jsonError('This payment is already recorded as successful.', 409);
      }

      await prisma.paymentTransaction.update({
        where: { id },
        data: {
          status: 'SUCCESS',
          resolvedById: user.id,
          resolvedAt: new Date(),
          resolutionNote: `Manually confirmed: ${note}`,
        },
      });

      let bidResult: { confirmed: boolean; reason?: string } | null = null;
      if (payment.bidId) {
        bidResult = await confirmBid(payment.bidId, { source: 'MANUAL_RECONCILIATION' });
      }

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'PAYMENT_MANUALLY_CONFIRMED',
        entity: 'PaymentTransaction',
        entityId: id,
        details: {
          transactionId: payment.transactionId,
          bidId: payment.bidId,
          note,
          bidConfirmed: bidResult?.confirmed,
          bidReason: bidResult?.reason,
        },
      });

      return NextResponse.json({ ok: true, bidConfirmed: bidResult?.confirmed ?? false });
    }

    case 'fail': {
      const guard = await requirePermission('payments', 'update');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      if (payment.status === 'SUCCESS') {
        return jsonError('Mark a successful payment as reversed instead of failed.', 409);
      }

      await prisma.paymentTransaction.update({
        where: { id },
        data: {
          status: 'FAILED',
          resolvedById: user.id,
          resolvedAt: new Date(),
          resolutionNote: `Manually failed: ${note}`,
        },
      });

      if (payment.bidId) await failBid(payment.bidId, `Payment marked failed by operator: ${note}`);

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'PAYMENT_MANUALLY_FAILED',
        entity: 'PaymentTransaction',
        entityId: id,
        details: { transactionId: payment.transactionId, bidId: payment.bidId, note },
      });

      return NextResponse.json({ ok: true });
    }

    case 'reverse': {
      const guard = await requirePermission('payments', 'approve');
      if (isGuardFailure(guard)) return guard.response;
      const { user } = guard;

      if (payment.status !== 'SUCCESS') {
        return jsonError('Only a successful payment can be reversed.', 409);
      }

      await prisma.$transaction(async (tx) => {
        await tx.paymentTransaction.update({
          where: { id },
          data: {
            status: 'REVERSED',
            resolvedById: user.id,
            resolvedAt: new Date(),
            resolutionNote: `Refund/reversal: ${note}`,
          },
        });

        // The fee is being given back, so the bid must stop counting toward
        // the auction result and the bidder's totals.
        if (payment.bidId && payment.bid?.status === 'ACTIVE') {
          await tx.bid.update({
            where: { id: payment.bidId },
            data: {
              status: 'REFUNDED',
              voidedAt: new Date(),
              voidReason: `Fee refunded: ${note}`,
            },
          });
          const bid = await tx.bid.findUnique({ where: { id: payment.bidId } });
          if (bid) {
            await tx.auction.update({
              where: { id: bid.auctionId },
              data: { bidCount: { decrement: 1 } },
            });
            await tx.bidder.update({
              where: { id: bid.bidderId },
              data: {
                totalBids: { decrement: 1 },
                totalSpent: { decrement: bid.feeAmount },
              },
            });
          }
        }
      });

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'PAYMENT_REVERSED',
        entity: 'PaymentTransaction',
        entityId: id,
        details: { transactionId: payment.transactionId, bidId: payment.bidId, note },
      });

      return NextResponse.json({ ok: true });
    }

    default:
      return jsonError(`Unsupported action: ${action || '(none)'}`, 400);
  }
}
