import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { clientMeta, jsonError, readJsonBody, tooManyRequests } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { completeAccountLink } from '@/lib/account-links';
import { consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';
import { ACCESS_COOKIE, REFRESH_COOKIE, deleteAdminSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Redeems an activation or reset link with the password its holder chose. */
export async function POST(req: NextRequest) {
  const limit = consumeRateLimit('accountLink', `addr:${addressKey(req.headers)}`);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const body = await readJsonBody(req, { secretFields: ['password', 'confirmPassword'] });
  if (body instanceof NextResponse) return body;

  const result = await completeAccountLink({
    token: body?.token,
    password: String(body?.password ?? ''),
    confirmPassword: String(body?.confirmPassword ?? ''),
  });

  if (!result.ok) {
    // A complaint about the password belongs under its field; a dead link has
    // no field to sit under, and nothing on the form will fix it.
    return result.field
      ? jsonError(result.error, 400, { field: result.field })
      : jsonError(result.error, 404);
  }

  await createAuditLog({
    actorId: result.holder.id,
    actorName: result.holder.fullName,
    action: result.purpose === 'ACTIVATION' ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_RESET_COMPLETED',
    entity: 'User',
    entityId: result.holder.id,
    ...clientMeta(req),
  });

  // Whoever was signed in on this browser is signed out, so that "Go to sign
  // in" leads to the sign-in form for the account that was just set up, not
  // into somebody else's console.
  const store = await cookies();
  const signedOut = Boolean(store.get(REFRESH_COOKIE)?.value || store.get(ACCESS_COOKIE)?.value);
  if (signedOut) await deleteAdminSession();

  return NextResponse.json({ ok: true, purpose: result.purpose, signedOut });
}
