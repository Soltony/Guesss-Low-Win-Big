import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { confirmBid, failBid } from '@/lib/bidding';
import { clientMeta } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { getSettings } from '@/lib/settings';
import { notify } from '@/lib/notifications';
import { tryDecryptBidAmount } from '@/lib/bid-crypto';
import { MASKED_AMOUNT, toNum } from '@/lib/format';
import {
  PaymentError,
  readTokenClaims,
  resolveGatewayConfig,
  unwrapSuperAppToken,
  validateSuperAppToken,
  verifyCallbackSignature,
} from '@/lib/payment-gateway';
import { headerMap, logSuperApp, newTrace } from '@/lib/superapp-debug';
import { consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Whether a callback whose signature does not match is rejected.
 *
 * Previously this defaulted to off, so a mismatched signature was recorded and
 * then processed anyway — leaving bid confirmation resting on bearer-token
 * validation alone, and making the signature a log entry rather than a control.
 * The default is now strict in production: switching it off is possible, but it
 * has to be said out loud, and it says so in the log every time it is used.
 */
function callbackStrictMode(): boolean {
  const configured = (process.env.PAYMENT_CALLBACK_STRICT || '').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[payment] PAYMENT_CALLBACK_STRICT=false in production: callbacks with a mismatched ' +
          'signature will be accepted. Confirm the signature format with the gateway and remove this.'
      );
    }
    return false;
  }
  // Unset: fail closed in production, stay permissive while integrating locally.
  return process.env.NODE_ENV === 'production';
}

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
  // Exempt from the proxy's origin check — a gateway has no browser origin to
  // present — so this is the only ceiling on how fast it can be replayed.
  // High, because a gateway legitimately retries a callback it thinks failed.
  const limit = consumeRateLimit('paymentCallback', addressKey(req.headers));
  if (!limit.ok) {
    const res = NextResponse.json({ message: 'Too many requests.' }, { status: 429 });
    res.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return res;
  }

  const meta = clientMeta(req);
  const trace = newTrace();
  let body: Record<string, any>;

  // Read the body as text first: the exact payload the gateway sent — spacing,
  // casing, field names and all — is what the signature was computed over.
  const rawBody = await req.text().catch(() => '');

  logSuperApp(`CALLBACK ← POST ${req.nextUrl.pathname}`, {
    trace,
    headers: headerMap(req.headers),
    rawBody,
    rawBodyLength: rawBody.length,
    ipAddress: meta.ipAddress,
  });

  try {
    body = JSON.parse(rawBody);
  } catch {
    logSuperApp('CALLBACK ✗ body is not valid JSON', { trace });
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }

  // The Authorization header sometimes arrives as `Bearer {"token":"..."}`.
  const rawAuth = req.headers.get('authorization');
  const bearer = unwrapSuperAppToken(rawAuth?.replace(/^Bearer\s+/i, ''));
  const authHeader = bearer ? `Bearer ${bearer}` : rawAuth;

  if (!authHeader) {
    logSuperApp('CALLBACK ✗ no authorization header', { trace });
    return NextResponse.json({ message: 'Authorization header is missing.' }, { status: 401 });
  }

  try {
    await validateSuperAppToken(authHeader, { trace, source: 'payment callback' });
  } catch (error) {
    const status = error instanceof PaymentError ? error.status : 401;
    console.error('[payment/callback] token validation failed', error);
    await createAuditLog({
      actorId: 'GATEWAY',
      actorType: 'EXTERNAL',
      action: 'PAYMENT_CALLBACK_REJECTED',
      details: {
        reason: 'Token validation failed',
        transactionId: body?.transactionId,
        detail: error instanceof Error ? error.message : String(error),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    // Only a `PaymentError` is written for the caller. Anything else is an
    // internal failure whose message names the token-validation host we could
    // not reach, or the shape of a response we did not expect — detail that
    // belongs in the log and the audit row, not in a reply to an unauthenticated
    // caller who has just failed authentication.
    return NextResponse.json(
      { message: error instanceof PaymentError ? error.message : 'Token validation failed.' },
      { status }
    );
  }

  // The callback does not put our id where we put it: this gateway returns
  // the uuid we signed as `txnRef` and fills `transactionId` with its own
  // core-banking reference (FT...). The signed token carries our id too. So
  // every candidate is tried rather than trusting one field name — reading
  // only `transactionId` leaves a paid bid stuck on "awaiting payment".
  const claims = readTokenClaims(body.token);
  const asId = (value: unknown) => (value === undefined || value === null ? '' : String(value));
  const candidateIds = [claims?.transactionId, body.txnRef, body.transactionId]
    .map(asId)
    .filter((value, index, all) => value && all.indexOf(value) === index);

  if (!candidateIds.length) {
    return NextResponse.json({ message: 'transactionId is required.' }, { status: 400 });
  }

  const transaction = await prisma.paymentTransaction.findFirst({
    where: { transactionId: { in: candidateIds } },
    include: { bidder: true, auction: { select: { code: true, title: true, currency: true } } },
  });

  if (!transaction) {
    logSuperApp('CALLBACK ✗ no transaction matches any id in the callback', {
      trace,
      candidateIds,
    });
    await createAuditLog({
      actorId: 'GATEWAY',
      actorType: 'EXTERNAL',
      action: 'PAYMENT_CALLBACK_UNKNOWN_TXN',
      details: { candidateIds },
      ipAddress: meta.ipAddress,
    });
    return NextResponse.json({ message: 'Unknown transaction.' }, { status: 404 });
  }

  const transactionId = transaction.transactionId;
  // Whatever the callback carries that is *not* our id is the gateway's own
  // reference — the number finance quotes to the bank when tracing a payment.
  const gatewayRef =
    [body.txnRef, body.transactionId].map(asId).find((value) => value && value !== transactionId) ||
    undefined;

  // ---- Signature check ----
  let signatureNote: string | undefined;
  try {
    const config = await resolveGatewayConfig();
    const check = verifyCallbackSignature(body, config, trace, {
      transactionId: transaction.transactionId,
      transactionTime: transaction.transactionTime,
    });
    if (!check.valid) {
      signatureNote = 'Callback signature did not match the expected value.';
      const strict = callbackStrictMode();
      await createAuditLog({
        actorId: 'GATEWAY',
        actorType: 'EXTERNAL',
        action: strict ? 'PAYMENT_CALLBACK_REJECTED' : 'PAYMENT_CALLBACK_SIGNATURE_MISMATCH',
        entity: 'PaymentTransaction',
        entityId: transaction.id,
        details: { transactionId, strict, received: check.received, expected: check.expected },
        ipAddress: meta.ipAddress,
      });
      if (strict) {
        return NextResponse.json({ message: 'Invalid signature.' }, { status: 401 });
      }
    }
  } catch (error) {
    signatureNote = `Signature could not be verified: ${(error as Error).message}`;
    logSuperApp('CALLBACK ✗ signature could not be verified', {
      trace,
      error: (error as Error).message,
    });
  }

  logSuperApp('CALLBACK ⇄ transaction resolved', {
    trace,
    transactionId,
    candidateIds,
    gatewayRef,
    bidId: transaction.bidId,
    storedStatus: transaction.status,
    expectedAmount: toNum(transaction.amount),
    reportedStatus: body.status,
    paidAmount: body.paidAmount ?? body.amount,
    signatureNote,
  });

  // ---- Idempotency ----
  if (transaction.status === 'SUCCESS') {
    return NextResponse.json({ message: 'Already processed.', status: 'SUCCESS' });
  }

  const reportedAmount = body.paidAmount ?? body.amount;
  // Distinguish "the gateway did not send an amount" from "the gateway said
  // zero". Treating both as success let a callback reporting a paid amount of
  // nought confirm a bid whose fee had not been collected.
  const amountReported =
    reportedAmount !== undefined &&
    reportedAmount !== null &&
    String(reportedAmount).trim() !== '';

  const paidAmount = Number(reportedAmount ?? 0);
  const expected = toNum(transaction.amount);
  const gatewaySaysPaid =
    body.status === undefined ||
    ['success', 'completed', 'paid', 'true', '0', '200'].includes(
      String(body.status).toLowerCase()
    );

  const amountMatches = Math.abs(paidAmount - expected) < 0.01;
  // With no amount in the payload the reported status is all there is to go on,
  // and the signature — which covers the amount field — is what attests it.
  const succeeded = gatewaySaysPaid && (amountReported ? amountMatches : true);

  const failureReason = !gatewaySaysPaid
    ? `Gateway reported status ${body.status}`
    : amountReported && !amountMatches
      ? `Paid amount ${paidAmount} does not match the expected fee ${expected}`
      : undefined;

  logSuperApp(`CALLBACK ⇄ verdict: ${succeeded ? 'paid' : 'not paid'}`, {
    trace,
    transactionId,
    gatewaySaysPaid,
    amountMatches,
    paidAmount,
    expected,
    failureReason,
  });

  await prisma.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      status: succeeded ? 'SUCCESS' : 'FAILED',
      txnRef: gatewayRef,
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
      txnRef: gatewayRef,
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
    txnRef: gatewayRef,
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
