import { createHash, randomUUID } from 'crypto';
import { format } from 'date-fns';
import prisma from './prisma';
import { getSettings } from './settings';
import { auditExternalRequest, auditExternalResponse, newCorrelationId } from './audit-log';
import { toNum } from './format';
import {
  describeValue,
  headerMap,
  logSuperApp,
  newTrace,
  superAppDebugEnabled,
  superAppSecretsShown,
} from './superapp-debug';

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
  /**
   * What the super app actually said, carried so a debug build can put it in
   * the API response — the phone in the webview has no terminal to read.
   * Surfaced only while SUPERAPP_DEBUG is on.
   */
  debug?: unknown;
  constructor(status: number, message: string, debug?: unknown) {
    super(message);
    this.status = status;
    this.debug = debug;
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
    logSuperApp('CONFIG  ✗ gateway is not configured', { missing });
    throw new PaymentError(
      500,
      `Payment gateway is not configured on the server (missing: ${missing.join(', ')}).`
    );
  }

  logSuperApp('CONFIG  gateway configuration resolved', {
    accountNo: describeValue(accountNo),
    companyName: describeValue(companyName),
    callbackUrl: describeValue(callbackUrl),
    paymentUrl: describeValue(paymentUrl),
    paymentKey: describeValue(key, { secret: true }),
    tokenValidationUrl: describeValue(process.env.TOKEN_VALIDATION_API_URL),
  });

  return { accountNo, companyName, callbackUrl, paymentUrl, key };
}

export interface SignatureParams {
  accountNo: string;
  amount: string;
  callBackURL: string;
  companyName: string;
  key: string;
  token: string;
  transactionId: string;
  transactionTime: string;
}

/** The exact bytes that get hashed. Split out so the debug log can print them. */
export function signatureBaseString(params: SignatureParams) {
  // Field order is part of the contract — do not sort or reorder.
  return [
    `accountNo=${params.accountNo}`,
    `amount=${params.amount}`,
    `callBackURL=${params.callBackURL}`,
    `companyName=${params.companyName}`,
    `Key=${params.key}`,
    `token=${params.token}`,
    `transactionId=${params.transactionId}`,
    `transactionTime=${params.transactionTime}`,
  ].join('&');
}

export function buildSignature(params: SignatureParams) {
  return createHash('sha256').update(signatureBaseString(params), 'utf8').digest('hex');
}

/**
 * Prints the signature input field by field.
 *
 * "Invalid data signature" is the whole of the gateway's complaint, so the only
 * way to find the disagreeing field is to see our side in full — each value
 * with its length, the joined base string, and the digest under every encoding
 * a gateway might have meant. Matching one of those against a worked example
 * from the integration spec settles it faster than asking.
 */
function logSignatureAttempt(event: string, trace: string, params: SignatureParams) {
  if (!superAppDebugEnabled()) return;

  const base = signatureBaseString(params);
  const shown =
    superAppSecretsShown() || !params.key
      ? base
      : base.split(`Key=${params.key}`).join('Key=<PAYMENT_KEY>');
  const digest = createHash('sha256').update(base, 'utf8').digest();

  logSuperApp(event, {
    trace,
    fields: {
      accountNo: describeValue(params.accountNo),
      amount: describeValue(params.amount),
      callBackURL: describeValue(params.callBackURL),
      companyName: describeValue(params.companyName),
      Key: describeValue(params.key, { secret: true }),
      token: describeValue(params.token, { secret: true }),
      transactionId: describeValue(params.transactionId),
      transactionTime: describeValue(params.transactionTime),
    },
    baseString: shown,
    baseStringLength: base.length,
    digests: {
      sha256Hex: digest.toString('hex'), // what we send
      sha256HexUpper: digest.toString('hex').toUpperCase(),
      sha256Base64: digest.toString('base64'),
      md5Hex: createHash('md5').update(base, 'utf8').digest('hex'),
    },
  });
}

/**
 * Pulls the bare JWT out of a token field.
 *
 * The super app sometimes hands us the token wrapped in its own JSON envelope —
 * `{"token":"eyJ..."}` — both in the Authorization header and in the callback
 * body, so every reader has to be ready for either shape.
 */
export function unwrapSuperAppToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    const inner = parsed?.token ?? parsed?.accessToken;
    if (typeof inner === 'string' && inner) return inner;
  } catch {
    // Not JSON after all — the regex below also catches a token that was
    // concatenated into some larger string.
  }
  return trimmed.match(/"token"\s*:\s*"([^"]+)"/)?.[1] ?? trimmed;
}

/**
 * Reads the claims out of a super-app JWT *without* verifying it.
 *
 * The signature over these claims is the gateway's to check, not ours — we only
 * want the `transactionId` and `transactionTime` they carry, because those are
 * the values we originally signed and the callback body renames and truncates
 * them. Nothing is authorised on the strength of these claims: the transaction
 * row, the token validation service and the callback signature all still have
 * to agree before a bid is confirmed.
 */
export function readTokenClaims(token: string | null | undefined): Record<string, any> | null {
  const bare = unwrapSuperAppToken(token);
  const segment = bare?.split('.')[1];
  if (!segment) return null;
  try {
    const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

export interface CallbackSignatureContext {
  /** The id we generated and signed, once the transaction has been resolved. */
  transactionId?: string | null;
  /** The full yyyyMMddHHmmss stamp we sent; the callback truncates it to a date. */
  transactionTime?: string | null;
}

export interface CallbackSignatureResult {
  valid: boolean;
  /** Which field arrangement produced the match, so this can be narrowed later. */
  matched: string | null;
  expected: string;
  received: string | null;
}

/**
 * Recomputes the signature of an inbound callback so we can detect tampering.
 *
 * The callback does not echo back what we sent: `transactionId` holds the
 * bank's own reference while ours arrives as `txnRef`, `transactionTime` is cut
 * down to a bare date, and the token may be JSON-wrapped. Which of those the
 * gateway actually hashed is not documented, so each plausible arrangement is
 * tried and the one that matched is reported. Every candidate is still keyed on
 * PAYMENT_KEY, so this widens the search, not the trust — a forger without the
 * key cannot satisfy any of them.
 */
export function verifyCallbackSignature(
  body: Record<string, any>,
  config: GatewayConfig,
  trace = newTrace(),
  context: CallbackSignatureContext = {}
): CallbackSignatureResult {
  const received = body.Signature || body.signature || null;

  const rawToken = body.token === undefined || body.token === null ? '' : String(body.token);
  const bareToken = unwrapSuperAppToken(rawToken) ?? rawToken;
  const claims = readTokenClaims(rawToken);

  /** Distinct non-empty candidates for one field, most likely first. */
  const pick = (...values: unknown[]) => {
    const out: string[] = [];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const text = String(value);
      if (text && !out.includes(text)) out.push(text);
    }
    return out.length ? out : [''];
  };

  const bodyTransactionId = String(body.transactionId ?? '');
  const candidates: Array<{ label: string; params: SignatureParams }> = [];

  for (const transactionId of pick(
    context.transactionId,
    claims?.transactionId,
    body.transactionId,
    body.txnRef
  )) {
    for (const transactionTime of pick(
      context.transactionTime,
      claims?.transactionTime,
      body.transactionTime
    )) {
      for (const token of pick(bareToken, rawToken)) {
        // The amount is deliberately NOT taken from the token claims: the
        // signature is what attests the sum that moved, and letting a claim
        // stand in for it would let a tampered paidAmount still match.
        for (const amount of pick(body.paidAmount, body.amount)) {
          candidates.push({
            label: [
              `transactionId=${transactionId === bodyTransactionId ? 'body' : 'ours'}`,
              `transactionTime=${transactionTime.length > 10 ? 'full' : 'date'}`,
              `token=${token === bareToken ? 'bare' : 'wrapped'}`,
              `amount=${amount}`,
            ].join(' '),
            params: {
              accountNo: String(body.accountNo ?? config.accountNo),
              amount,
              callBackURL: config.callbackUrl,
              companyName: config.companyName,
              key: config.key,
              token,
              transactionId,
              transactionTime,
            },
          });
        }
      }
    }
  }

  const receivedText = received ? String(received).toLowerCase() : null;
  let matched: { label: string; params: SignatureParams; digest: string } | null = null;
  for (const candidate of candidates) {
    const digest = buildSignature(candidate.params);
    if (receivedText && digest.toLowerCase() === receivedText) {
      matched = { ...candidate, digest };
      break;
    }
  }

  // With no match there is nothing to report but our best guess, which is what
  // the log needs anyway to show how far off it was.
  const reported = matched ?? {
    ...candidates[0],
    digest: buildSignature(candidates[0].params),
  };

  logSignatureAttempt('CALLBACK ⇄ recomputing the callback signature', trace, reported.params);
  logSuperApp('CALLBACK ⇄ signature comparison', {
    trace,
    valid: Boolean(matched),
    matched: matched?.label ?? null,
    candidatesTried: candidates.length,
    expected: reported.digest,
    received: received ? String(received) : null,
  });

  return {
    valid: Boolean(matched),
    matched: matched?.label ?? null,
    expected: reported.digest,
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
  /**
   * The gateway's own token for this charge. The super app will not raise its
   * PIN sheet until the webview hands this token back over the JS channel, so
   * it has to travel all the way out to the browser — a transaction id alone
   * leaves the bidder watching a spinner no wallet prompt ever answers.
   */
  paymentToken: string;
  gatewayResponse: unknown;
}

/** Digs the payment token out of whatever shape the gateway wrapped it in. */
function readPaymentToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, any>;
  const candidate = record.token ?? record.paymentToken ?? record.data?.token;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

export async function initiateBidFeePayment(
  input: InitiatePaymentInput
): Promise<InitiatePaymentResult> {
  // The audit correlation id doubles as the console trace, so a line in the
  // terminal and a row in the audit table can be matched up.
  const correlationId = newCorrelationId();

  logSuperApp('PAYMENT ↥ mini app asked us to charge a bid fee', {
    trace: correlationId,
    bidId: input.bidId,
    bidderId: input.bidderId,
    auctionId: input.auctionId,
    amount: input.amount,
    token: input.superAppToken,
  });

  const config = await resolveGatewayConfig();

  const transactionId = randomUUID();
  const transactionTime = format(new Date(), 'yyyyMMddHHmmss');
  const amount = toNum(input.amount).toFixed(2);

  const signatureParams: SignatureParams = {
    accountNo: config.accountNo,
    amount,
    callBackURL: config.callbackUrl,
    companyName: config.companyName,
    key: config.key,
    token: input.superAppToken,
    transactionId,
    transactionTime,
  };
  const signature = buildSignature(signatureParams);

  logSignatureAttempt('PAYMENT → signing the request', correlationId, signatureParams);

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

  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.superAppToken}`,
  };
  const requestBody = JSON.stringify(payload);

  logSuperApp(`PAYMENT → POST ${config.paymentUrl}`, {
    trace: correlationId,
    headers: requestHeaders,
    // `signature` stays in the clear: it is the value under investigation.
    body: payload,
    rawBodyLength: requestBody.length,
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(config.paymentUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      cache: 'no-store',
    });
  } catch (error: any) {
    logSuperApp('PAYMENT ✗ gateway unreachable', {
      trace: correlationId,
      url: config.paymentUrl,
      error: error?.message,
      durationMs: Date.now() - startedAt,
    });
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

  const durationMs = Date.now() - startedAt;
  const body = await response
    .clone()
    .json()
    .catch(async () => response.text().catch(() => null));

  logSuperApp('PAYMENT ← gateway response', {
    trace: correlationId,
    status: `${response.status} ${response.statusText}`,
    ok: response.ok,
    durationMs,
    headers: headerMap(response.headers),
    body,
  });

  await auditExternalResponse(auditBase, {
    status: response.status,
    body,
    durationMs,
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

    logSuperApp('PAYMENT ✗ gateway rejected the request', {
      trace: correlationId,
      status: response.status,
      message: String(message),
      transactionId,
    });

    throw new PaymentError(response.status, String(message), {
      trace: correlationId,
      stage: 'PAYMENT_INITIATE',
      status: response.status,
      transactionId,
      gatewayBody: body,
    });
  }

  const paymentToken = readPaymentToken(body);
  if (!paymentToken) {
    // A 200 with no token is not a charge in flight: the wallet will never be
    // asked, so fail it here rather than leave the bid pending on a prompt that
    // can no longer be raised.
    logSuperApp('PAYMENT ✗ accepted but no payment token came back', {
      trace: correlationId,
      transactionId,
      body,
    });
    await prisma.paymentTransaction.update({
      where: { transactionId },
      data: { status: 'FAILED', failureReason: 'Payment token not received from the gateway.' },
    });
    throw new PaymentError(502, 'Payment token not received from the gateway.', {
      trace: correlationId,
      stage: 'PAYMENT_INITIATE',
      status: response.status,
      transactionId,
      gatewayBody: body,
    });
  }

  logSuperApp('PAYMENT ✓ accepted, token issued — the webview must now prompt the wallet', {
    trace: correlationId,
    transactionId,
    paymentToken: describeValue(paymentToken, { secret: true }),
    callbackUrl: config.callbackUrl,
  });

  await prisma.paymentTransaction.update({
    where: { transactionId },
    data: { gatewayStatus: String(response.status) },
  });

  return { transactionId, status: 'PENDING', paymentToken, gatewayResponse: body };
}

/** Validates a super-app token against the token validation service. */
export async function validateSuperAppToken(
  authHeader: string,
  context: { trace?: string; source?: string } = {}
): Promise<{ phone: string }> {
  const trace = context.trace ?? newTrace();
  const url = process.env.TOKEN_VALIDATION_API_URL;

  if (!url) {
    logSuperApp('TOKEN  ✗ TOKEN_VALIDATION_API_URL is not set', { trace, source: context.source });
    throw new PaymentError(500, 'The token validation URL is not configured.');
  }
  if (!authHeader?.startsWith('Bearer ')) {
    logSuperApp('TOKEN  ✗ authorization header is missing or malformed', {
      trace,
      source: context.source,
      received: describeValue(authHeader, { secret: true }),
    });
    throw new PaymentError(400, 'Super App token is missing or malformed.');
  }

  logSuperApp(`TOKEN → GET ${url}`, {
    trace,
    source: context.source,
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error: any) {
    logSuperApp('TOKEN  ✗ validation service unreachable', {
      trace,
      url,
      error: error?.message,
      durationMs: Date.now() - startedAt,
    });
    throw new PaymentError(502, `Token validation request failed: ${error?.message}`);
  }

  // Read the body once as text: a non-JSON error page is exactly the kind of
  // response worth seeing in full, and `.json()` would have thrown it away.
  const raw = await response.text().catch(() => '');
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* left null — the raw text is logged instead */
  }

  logSuperApp('TOKEN ← validation response', {
    trace,
    status: `${response.status} ${response.statusText}`,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    headers: headerMap(response.headers),
    body: parsed ?? raw,
  });

  if (!response.ok) {
    const message = parsed?.message
      ? String(parsed.message)
      : `Token validation failed (status ${response.status}).`;
    throw new PaymentError(response.status, message, {
      trace,
      stage: 'TOKEN_VALIDATION',
      status: response.status,
      body: parsed ?? raw,
    });
  }

  const phone = parsed?.phone;
  if (!phone) {
    throw new PaymentError(400, 'Phone number not found in the validation response.', {
      trace,
      stage: 'TOKEN_VALIDATION',
      body: parsed ?? raw,
    });
  }
  return { phone: String(phone) };
}
