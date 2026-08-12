import { createHash, randomUUID } from 'crypto';
import { format } from 'date-fns';
import prisma from './prisma';
import { getSettings } from './settings';
import { auditExternalRequest, auditExternalResponse, newCorrelationId } from './audit-log';
import { toNum } from './format';

/**
 * Super-app payment gateway integration.
 *
 * Mirrors the loan-repayment flow: we sign a request with the merchant key and
 * the bidder's super-app token, the super app collects the money from the
 * customer's wallet, then calls our callback. A bid only becomes ACTIVE once
 * that callback confirms the fee was paid.
 */

export class PaymentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface GatewayConfig {
  accountNo: string;
  companyName: string;
  callbackUrl: string;
  paymentUrl: string;
  key: string;
}

export async function resolveGatewayConfig(): Promise<GatewayConfig> {
  const settings = await getSettings();

  // Settings win over env so the merchant details can be corrected without a
  // redeploy; env stays the fallback and holds the secret key.
  const accountNo = String(settings['payments.accountNo'] || '') || process.env.ACCOUNT_NO || '';
  const companyName =
    String(settings['payments.companyName'] || '') || process.env.COMPANY_NAME || '';
  const callbackUrl = process.env.CALLBACK_URL || '';
  const paymentUrl = process.env.PAYMENT_URL || '';
  const key = process.env.PAYMENT_KEY || '';

  const missing = [
    !accountNo && 'accountNo',
    !companyName && 'companyName',
    !callbackUrl && 'CALLBACK_URL',
    !paymentUrl && 'PAYMENT_URL',
    !key && 'PAYMENT_KEY',
  ].filter(Boolean);

  if (missing.length) {
    throw new PaymentError(
      500,
      `Payment gateway is not configured on the server (missing: ${missing.join(', ')}).`
    );
  }

  return { accountNo, companyName, callbackUrl, paymentUrl, key };
}

export function buildSignature(params: {
  accountNo: string;
  amount: string;
  callBackURL: string;
  companyName: string;
  key: string;
  token: string;
  transactionId: string;
  transactionTime: string;
}) {
  // Field order is part of the contract — do not sort or reorder.
  const signatureString = [
    `accountNo=${params.accountNo}`,
    `amount=${params.amount}`,
    `callBackURL=${params.callBackURL}`,
    `companyName=${params.companyName}`,
    `Key=${params.key}`,
    `token=${params.token}`,
    `transactionId=${params.transactionId}`,
    `transactionTime=${params.transactionTime}`,
  ].join('&');

  return createHash('sha256').update(signatureString, 'utf8').digest('hex');
}

/** Recomputes the signature of an inbound callback so we can detect tampering. */
export function verifyCallbackSignature(
  body: Record<string, any>,
  config: GatewayConfig
): { valid: boolean; expected: string; received: string | null } {
  const received = body.Signature || body.signature || null;
  const expected = buildSignature({
    accountNo: String(body.accountNo ?? config.accountNo),
    amount: String(body.paidAmount ?? body.amount ?? ''),
    callBackURL: config.callbackUrl,
    companyName: config.companyName,
    key: config.key,
    token: String(body.token ?? ''),
    transactionId: String(body.transactionId ?? ''),
    transactionTime: String(body.transactionTime ?? ''),
  });

  return {
    valid: Boolean(received) && String(received).toLowerCase() === expected.toLowerCase(),
    expected,
    received: received ? String(received) : null,
  };
}

export interface InitiatePaymentInput {
  bidId: string;
  bidderId: string;
  auctionId: string;
  amount: number;
  superAppToken: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface InitiatePaymentResult {
  transactionId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  gatewayResponse: unknown;
}

export async function initiateBidFeePayment(
  input: InitiatePaymentInput
): Promise<InitiatePaymentResult> {
  const config = await resolveGatewayConfig();

  const transactionId = randomUUID();
  const transactionTime = format(new Date(), 'yyyyMMddHHmmss');
  const amount = toNum(input.amount).toFixed(2);

  const signature = buildSignature({
    accountNo: config.accountNo,
    amount,
    callBackURL: config.callbackUrl,
    companyName: config.companyName,
    key: config.key,
    token: input.superAppToken,
    transactionId,
    transactionTime,
  });

  const payload = {
    accountNo: config.accountNo,
    amount,
    callBackURL: config.callbackUrl,
    companyName: config.companyName,
    token: input.superAppToken,
    transactionId,
    transactionTime,
    signature,
  };

  await prisma.paymentTransaction.create({
    data: {
      transactionId,
      bidderId: input.bidderId,
      auctionId: input.auctionId,
      bidId: input.bidId,
      amount: input.amount,
      purpose: 'BID_FEE',
      status: 'PENDING',
      accountNo: config.accountNo,
      transactionTime,
      // The token is never persisted — sanitizeDetails would redact it anyway.
      requestPayload: JSON.stringify({ ...payload, token: '***', signature: '***' }),
    },
  });

  const correlationId = newCorrelationId();
  const auditBase = {
    actorId: input.bidderId,
    actorType: 'BIDDER' as const,
    integration: 'PAYMENT_GATEWAY',
    entity: 'Bid',
    entityId: input.bidId,
    correlationId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };

  await auditExternalRequest(auditBase, {
    method: 'POST',
    url: config.paymentUrl,
    body: { ...payload, token: '***', signature: '***' },
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(config.paymentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.superAppToken}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch (error: any) {
    await prisma.paymentTransaction.update({
      where: { transactionId },
      data: { status: 'FAILED', failureReason: `Gateway unreachable: ${error?.message}` },
    });
    await auditExternalResponse(auditBase, {
      status: 0,
      body: { error: error?.message },
      durationMs: Date.now() - startedAt,
    });
    throw new PaymentError(502, 'Could not reach the payment service. Please try again.');
  }

  const body = await response
    .clone()
    .json()
    .catch(async () => response.text().catch(() => null));

  await auditExternalResponse(auditBase, {
    status: response.status,
    body,
    durationMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    await prisma.paymentTransaction.update({
      where: { transactionId },
      data: {
        status: 'FAILED',
        gatewayStatus: String(response.status),
        failureReason: typeof body === 'string' ? body.slice(0, 2000) : JSON.stringify(body ?? {}),
      },
    });
    const message =
      (body && typeof body === 'object' && (body as any).message) ||
      `Payment request was rejected (status ${response.status}).`;
    throw new PaymentError(response.status, String(message));
  }

  await prisma.paymentTransaction.update({
    where: { transactionId },
    data: { gatewayStatus: String(response.status) },
  });

  return { transactionId, status: 'PENDING', gatewayResponse: body };
}

/** Validates a super-app token against the token validation service. */
export async function validateSuperAppToken(authHeader: string): Promise<{ phone: string }> {
  const url = process.env.TOKEN_VALIDATION_API_URL;
  if (!url) throw new PaymentError(500, 'The token validation URL is not configured.');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new PaymentError(400, 'Super App token is missing or malformed.');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error: any) {
    throw new PaymentError(502, `Token validation request failed: ${error?.message}`);
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = `Token validation failed (status ${response.status}).`;
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed?.message) message = String(parsed.message);
    } catch {
      /* keep the default message */
    }
    throw new PaymentError(response.status, message);
  }

  const data = await response.json();
  const phone = data?.phone;
  if (!phone) throw new PaymentError(400, 'Phone number not found in the validation response.');
  return { phone: String(phone) };
}
