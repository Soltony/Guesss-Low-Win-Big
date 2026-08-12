import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession } from '@/lib/session';
import { jsonError } from '@/lib/api';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Polled by the bid sheet while the super app collects the service fee, so the
 * UI can flip from "confirming payment" to "bid confirmed" without a refresh.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const { id } = await params;
  const bid = await prisma.bid.findUnique({
    where: { id },
    include: { payment: { select: { status: true, failureReason: true, txnRef: true } } },
  });

  if (!bid) return jsonError('Bid not found', 404);
  if (bid.bidderId !== session.bidderId) return jsonError('Not found', 404);

  return NextResponse.json({
    id: bid.id,
    status: bid.status,
    amount: toNum(bid.amount),
    feeAmount: toNum(bid.feeAmount),
    sequence: bid.sequence,
    confirmedAt: bid.confirmedAt?.toISOString() ?? null,
    voidReason: bid.voidReason,
    payment: bid.payment
      ? {
          status: bid.payment.status,
          txnRef: bid.payment.txnRef,
          failureReason: bid.payment.failureReason,
        }
      : null,
  });
}
