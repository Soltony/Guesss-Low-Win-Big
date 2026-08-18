import { describe, expect, it } from 'vitest';
import {
  buildSignature,
  readTokenClaims,
  unwrapSuperAppToken,
  verifyCallbackSignature,
  type GatewayConfig,
} from './payment-gateway';

/**
 * The payload shape below is a real NIB callback, secrets aside.
 *
 * It is worth pinning down because it contradicts what we sent: the uuid we
 * generated and signed comes back as `txnRef`, `transactionId` holds the
 * bank's own core-banking reference, `transactionTime` is cut down to a date,
 * and `token` is a JSON envelope around the JWT rather than the JWT itself.
 * Reading `transactionId` as ours — the obvious thing — silently strands a paid
 * bid on "awaiting payment", so these tests hold the mapping in place.
 */

/** Ours, as we generated it. */
const OUR_ID = 'a3e9c208-536e-46a3-bd9b-60d7c7930d0d';
/** The bank's reference, which the callback puts in `transactionId`. */
const BANK_REF = 'FT252744CDJ0';
const OUR_TIME = '20260818100556';

const JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJ0cmFuc2FjdGlvbklkIjoiYTNlOWMyMDgtNTM2ZS00NmEzLWJkOWItNjBkN2M3OTMwZDBkIiwiY29tcGFueU5hbWUiOi' +
    'JOSUJCTlBMIiwiYW1vdW50IjoiNTAuMDAiLCJhY2NvdW50Tm8iOiI3MDAwMTAxNjMzMzg3IiwidHJhbnNhY3Rpb25UaW1' +
    'lIjoiMjAyNjA4MTgxMDA1NTYiLCJjYWxsQmFja1VSTCI6Imh0dHBzOi8vbmlidGVyYWJucGwubmliYmFuay5jb20uZXQv' +
    'YXBpL3BheW1lbnQvY2FsbGJhY2siLCJjdXN0b21lck5hbWUiOiJBTElZIFVNRVIgQUhNRUQiLCJwaG9uZSI6IjI1MTk0O' +
    'TM4NTY0NiIsImp0aSI6IjBmNWZjOTRlLTk2YjktNDJlMy1hOTQ3LTc0NmU5YjRlOTI4NCIsImV4cCI6MTc5MDY3Mjc1Ny' +
    'wiaXNzIjoiTmlidGVyYU1pbmlBcHBJc3N1ZXIiLCJhdWQiOiJOaWJ0ZXJhTWluaUFwcCJ9',
  'NbS_-lLVjzqrTU-4Xib7RFjnFczFw-o5kDBM7Xxr-SQ',
].join('.');

const CALLBACK_BODY = {
  paidAmount: '50.00',
  paidByNumber: '251949385646',
  txnRef: OUR_ID,
  transactionId: BANK_REF,
  accountNo: '7000101633387',
  transactionTime: '2026-08-18',
  token: JSON.stringify({ token: JWT }),
};

const CONFIG: GatewayConfig = {
  accountNo: '7000101633387',
  companyName: 'NIBBNPL',
  callbackUrl: 'https://nibterabnpl.nibbank.com.et/api/payment/callback',
  paymentUrl: 'https://superapp.example.et/api/payment/initiate',
  key: 'test-payment-key',
};

/** How the callback route picks the id to look the transaction up by. */
function candidateIds(body: Record<string, any>) {
  const claims = readTokenClaims(body.token);
  const asId = (value: unknown) => (value === undefined || value === null ? '' : String(value));
  return [claims?.transactionId, body.txnRef, body.transactionId]
    .map(asId)
    .filter((value, index, all) => value && all.indexOf(value) === index);
}

describe('unwrapSuperAppToken', () => {
  it('takes the JWT out of the JSON envelope the super app wraps it in', () => {
    expect(unwrapSuperAppToken(CALLBACK_BODY.token)).toBe(JWT);
  });

  it('leaves a bare JWT alone', () => {
    expect(unwrapSuperAppToken(JWT)).toBe(JWT);
  });

  it('has nothing to say about an absent token', () => {
    expect(unwrapSuperAppToken(null)).toBeNull();
    expect(unwrapSuperAppToken('')).toBeNull();
  });
});

describe('readTokenClaims', () => {
  it('recovers the id and the full timestamp we signed', () => {
    const claims = readTokenClaims(CALLBACK_BODY.token);
    expect(claims?.transactionId).toBe(OUR_ID);
    expect(claims?.transactionTime).toBe(OUR_TIME);
    expect(claims?.amount).toBe('50.00');
  });

  it('returns null rather than throwing on a token it cannot read', () => {
    expect(readTokenClaims('not-a-jwt')).toBeNull();
    expect(readTokenClaims(undefined)).toBeNull();
  });
});

describe('resolving the transaction a callback belongs to', () => {
  it('offers our own id first, not the bank reference in transactionId', () => {
    expect(candidateIds(CALLBACK_BODY)[0]).toBe(OUR_ID);
  });

  it('still finds our id when the token is missing, via txnRef', () => {
    expect(candidateIds({ ...CALLBACK_BODY, token: undefined })).toEqual([OUR_ID, BANK_REF]);
  });

  it('keeps the bank reference as a candidate, for a gateway that does echo ours back', () => {
    expect(candidateIds(CALLBACK_BODY)).toContain(BANK_REF);
  });
});

describe('verifyCallbackSignature', () => {
  /** Signs the way the gateway would under one particular field arrangement. */
  const sign = (over: { transactionId: string; transactionTime: string; token: string }) =>
    buildSignature({
      accountNo: CONFIG.accountNo,
      amount: '50.00',
      callBackURL: CONFIG.callbackUrl,
      companyName: CONFIG.companyName,
      key: CONFIG.key,
      ...over,
    });

  it('matches when the gateway signed over the id and time we sent', () => {
    const signature = sign({ transactionId: OUR_ID, transactionTime: OUR_TIME, token: JWT });
    const result = verifyCallbackSignature({ ...CALLBACK_BODY, signature }, CONFIG);
    expect(result.valid).toBe(true);
  });

  it('matches when it signed over the values as they appear in the callback', () => {
    const signature = sign({
      transactionId: BANK_REF,
      transactionTime: '2026-08-18',
      token: CALLBACK_BODY.token,
    });
    const result = verifyCallbackSignature({ ...CALLBACK_BODY, signature }, CONFIG);
    expect(result.valid).toBe(true);
  });

  it('matches a mixed arrangement — our id, the wrapped token', () => {
    const signature = sign({
      transactionId: OUR_ID,
      transactionTime: '2026-08-18',
      token: CALLBACK_BODY.token,
    });
    const result = verifyCallbackSignature({ ...CALLBACK_BODY, signature }, CONFIG);
    expect(result.valid).toBe(true);
  });

  it('names the arrangement that matched, so the set can be narrowed later', () => {
    const signature = sign({ transactionId: OUR_ID, transactionTime: OUR_TIME, token: JWT });
    const result = verifyCallbackSignature({ ...CALLBACK_BODY, signature }, CONFIG);
    expect(result.matched).toContain('token=bare');
    expect(result.matched).toContain('transactionTime=full');
  });

  it('rejects a signature made with the wrong key — the point of the check', () => {
    const forged = buildSignature({
      accountNo: CONFIG.accountNo,
      amount: '50.00',
      callBackURL: CONFIG.callbackUrl,
      companyName: CONFIG.companyName,
      key: 'not-the-payment-key',
      token: JWT,
      transactionId: OUR_ID,
      transactionTime: OUR_TIME,
    });
    expect(verifyCallbackSignature({ ...CALLBACK_BODY, signature: forged }, CONFIG).valid).toBe(
      false
    );
  });

  it('rejects a tampered amount', () => {
    const signature = sign({ transactionId: OUR_ID, transactionTime: OUR_TIME, token: JWT });
    const result = verifyCallbackSignature(
      { ...CALLBACK_BODY, paidAmount: '5000.00', signature },
      CONFIG
    );
    expect(result.valid).toBe(false);
  });

  it('reports invalid, not a crash, when no signature came at all', () => {
    const result = verifyCallbackSignature(CALLBACK_BODY, CONFIG);
    expect(result.valid).toBe(false);
    expect(result.received).toBeNull();
  });

  it('accepts the capitalised Signature field the gateway sometimes uses', () => {
    const Signature = sign({ transactionId: OUR_ID, transactionTime: OUR_TIME, token: JWT });
    expect(verifyCallbackSignature({ ...CALLBACK_BODY, Signature }, CONFIG).valid).toBe(true);
  });
});
