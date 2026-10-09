import { after, NextRequest, NextResponse } from 'next/server';
import { clientMeta, jsonError, readJsonBody, tooManyRequests } from '@/lib/api';
import { isValidEmail } from '@/lib/admin-users';
import { requestPasswordReset } from '@/lib/account-links';
import { consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * "Forgot password" from the sign-in page. The answer is the same whatever
 * the address, and it goes out before anything is looked up: finding the
 * account and sending the email happen afterwards, so neither the reply nor
 * how long it took can tell a caller whether the address has an account.
 */
export async function POST(req: NextRequest) {
  const meta = clientMeta(req);
  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !isValidEmail(email)) {
    return jsonError('Enter the email address you sign in with.', 400, { field: 'email' });
  }

  // Both windows are keyed on what was sent, never on whether it matched an
  // account, so a refusal here says nothing more than the answer below does.
  const perCaller = consumeRateLimit('passwordResetRequest', `addr:${addressKey(req.headers)}`);
  const perAddress = consumeRateLimit('passwordResetEmail', `email:${email}`);
  if (!perCaller.ok || !perAddress.ok) {
    return tooManyRequests(
      Math.max(perCaller.retryAfterSeconds, perAddress.retryAfterSeconds),
      'Too many reset requests. Wait a while before asking again.'
    );
  }

  after(() =>
    requestPasswordReset(email, meta).catch((error) =>
      console.error('[account-links] password reset request failed', error)
    )
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
