import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { confirmBid, failBid } from '@/lib/bidding';
import { clientMeta, enforceRateLimit } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createAuditLog } from '@/lib/audit-log';
import { getSettings } from '@/lib/settings';
import { notify } from '@/lib/notifications';
import { tryDecryptBidAmount } from '@/lib/bid-crypto';
import { MASKED_AMOUNT, toNum } from '@/lib/format';
import {
  PaymentError,
  resolveGatewayConfig,
  validateSuperAppToken,
  verifyCallbackSignature,
} from '@/lib/payment-gateway';

export const dynamic = 'force-dynamic';

/**
 * Payment gateway callback.
 *
 * The gateway calls this after collecting the bid service fee from the
 * customer's wallet. This is the only place a bid becomes ACTIVE.
 *
 * Defensive by design: the callback is authenticated, the transaction must
 * exist and be PENDING, and confirmation is idempotent because gateways retry.
 */
export async function POST(req: NextRequest) {
  const meta = clientMeta(req);

  // Publicly reachable by necessity — the gateway must be able to call it. The
  // ceiling is set well above the gateway's own retry behaviour, so it only
  // ever engages against a flood.
  const limited = enforceRateLimit('payment-callback', meta.ipAddress, RATE_LIMITS.paymentCallback);
  if (limited) return limited;

  let body: Record<string, any>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }

  // The Authorization header sometimes arrives as `Bearer {"token":"..."}`.
  const rawAuth = req.headers.get('authorization');
  const embedded = rawAuth?.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
  const authHeader = embedded ? `Bearer ${embedded}` : rawAuth;

  if (!authHeader) {
    return NextResponse.json({ message: 'Authorization header is missing.' }, { status: 401 });
  }

  try {
    await validateSuperAppToken(authHeader);
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 401;
    await createAuditLog({
      actorId: 'GATEWAY',
      actorType: 'EXTERNAL',
      action: 'PAYMENT_CALLBACK_REJECTED',
      details: { reason: 'Token validation failed', transactionId: body?.transactionId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Token validation failed.' },
      { status }
    );
  }

  const transactionId = String(body.transactionId || '');
  if (!transactionId) {
    return NextResponse.json({ message: 'transactionId is required.' }, { status: 400 });
  }

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { transactionId },
    include: { bidder: true, auction: { select: { code: true, title: true, currency: true } } },
  });

  if (!transaction) {
    await createAuditLog({
      actorId: 'GATEWAY',
      actorType: 'EXTERNAL',
      action: 'PAYMENT_CALLBACK_UNKNOWN_TXN',
      details: { transactionId },
      ipAddress: meta.ipAddress,
    });
    return NextResponse.json({ message: 'Unknown transaction.' }, { status: 404 });
  }

  // ---- Signature check ----
  let signatureNote: string | undefined;
  try {
    const config = await resolveGatewayConfig();
    const check = verifyCallbackSignature(body, config);
    if (!check.valid) {
      signatureNote = 'Callback signature did not match the expected value.';
      const strict = process.env.PAYMENT_CALLBACK_STRICT === 'true';
      await createAuditLog({
        actorId: 'GATEWAY',
        actorType: 'EXTERNAL',
        action: strict ? 'PAYMENT_CALLBACK_REJECTED' : 'PAYMENT_CALLBACK_SIGNATURE_MISMATCH',
        entity: 'PaymentTransaction',
        entityId: transaction.id,
        details: { transactionId, strict, received: check.received },
        ipAddress: meta.ipAddress,
      });
      if (strict) {
        return NextResponse.json({ message: 'Invalid signature.' }, { status: 401 });
      }
    }
  } catch (error) {
    signatureNote = `Signature could not be verified: ${(error as Error).message}`;
  }

  // ---- Idempotency ----
  if (transaction.status === 'SUCCESS') {
    return NextResponse.json({ message: 'Already processed.', status: 'SUCCESS' });
  }

  const paidAmount = Number(body.paidAmount ?? body.amount ?? 0);
  const expected = toNum(transaction.amount);
  const gatewaySaysPaid =
    body.status === undefined ||
    ['success', 'completed', 'paid', 'true', '0', '200'].includes(
      String(body.status).toLowerCase()
    );

  const amountMatches = Math.abs(paidAmount - expected) < 0.01;
  const succeeded = gatewaySaysPaid && (paidAmount === 0 || amountMatches);

  const failureReason = !gatewaySaysPaid
    ? `Gateway reported status ${body.status}`
    : !amountMatches && paidAmount !== 0
      ? `Paid amount ${paidAmount} does not match the expected fee ${expected}`
      : undefined;

  await prisma.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      status: succeeded ? 'SUCCESS' : 'FAILED',
      txnRef: body.txnRef ? String(body.txnRef) : undefined,
      paidByNumber: body.paidByNumber ? String(body.paidByNumber) : undefined,
      gatewayStatus: body.status !== undefined ? String(body.status) : undefined,
      failureReason: [failureReason, signatureNote].filter(Boolean).join(' | ') || undefined,
      callbackPayload: JSON.stringify({ ...body, token: '***', Signature: '***' }).slice(0, 8000),
    },
  });

  await createAuditLog({
    actorId: transaction.bidder.phoneNumber,
    actorType: 'EXTERNAL',
    action: succeeded ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
    entity: 'PaymentTransaction',
    entityId: transaction.id,
    details: {
      transactionId,
      txnRef: body.txnRef,
      paidAmount,
      expected,
      bidId: transaction.bidId,
      signatureNote,
    },
    ipAddress: meta.ipAddress,
  });

  if (!transaction.bidId) {
    return NextResponse.json({ message: 'Recorded.', status: succeeded ? 'SUCCESS' : 'FAILED' });
  }

  if (!succeeded) {
    await failBid(transaction.bidId, failureReason || 'Payment failed');
    return NextResponse.json({ message: 'Payment failed.', status: 'FAILED' }, { status: 200 });
  }

  const result = await confirmBid(transaction.bidId, {
    source: 'PAYMENT_CALLBACK',
    txnRef: body.txnRef ? String(body.txnRef) : undefined,
    paidByNumber: body.paidByNumber ? String(body.paidByNumber) : undefined,
  });

  // A payment that lands after its bid was voided (e.g. the auction closed
  // first) is money taken for nothing — flag it so finance can refund.
  if (!result.confirmed) {
    const settings = await getSettings();
    if (settings['payments.refundVoidedBids']) {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'REVERSED',
          resolutionNote: `Payment succeeded but the bid could not be confirmed: ${result.reason}. Flagged for refund.`,
        },
      });
      await createAuditLog({
        actorId: 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'PAYMENT_FLAGGED_FOR_REFUND',
        entity: 'PaymentTransaction',
        entityId: transaction.id,
        details: { reason: result.reason, bidId: transaction.bidId },
      });
    }
    return NextResponse.json({ message: result.reason, status: 'SUCCESS_UNAPPLIED' });
  }

  const settings = await getSettings();
  if (settings['notifications.onBidConfirmed']) {
    const bid = await prisma.bid.findUnique({
      where: { id: transaction.bidId },
      select: { auctionId: true, bidderId: true, amountCipher: true, feeAmount: true },
    });
    const amount = bid
      ? tryDecryptBidAmount(bid.amountCipher, {
          auctionId: bid.auctionId,
          bidderId: bid.bidderId,
        })
      : null;

    await notify({
      code: 'BID_CONFIRMED',
      recipient: transaction.bidder.phoneNumber,
      language: transaction.bidder.language === 'am' ? 'am' : 'en',
      bidderId: transaction.bidderId,
      auctionId: transaction.auctionId ?? undefined,
      vars: {
        fee: toNum(bid?.feeAmount).toFixed(2),
        currency: transaction.auction?.currency ?? 'ETB',
        code: transaction.auction?.code ?? '',
        title: transaction.auction?.title ?? '',
      },
      // The bidder gets their amount in the SMS; the delivery log gets a mask.
      secretVars: { amount: amount === null ? MASKED_AMOUNT : amount.toFixed(2) },
    });
  }

  return NextResponse.json({ message: 'Bid confirmed.', status: 'SUCCESS' });
}
