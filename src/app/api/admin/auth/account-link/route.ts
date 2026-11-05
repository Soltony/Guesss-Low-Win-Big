import { NextRequest, NextResponse } from 'next/server';
import { jsonError, readJsonBody, tooManyRequests } from '@/lib/api';
import { DEAD_LINK, findLiveLink } from '@/lib/account-links';
import { consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * What an emailed link is for, so the page it opens can greet its holder and
 * say when it lapses before they choose a password. Looking a link up does not
 * use it: a mail scanner that opens the page cannot spend somebody's invitation.
 */
export async function POST(req: NextRequest) {
  const limit = consumeRateLimit('accountLink', `addr:${addressKey(req.headers)}`);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;

  const link = await findLiveLink(body?.token);
  if (!link) return jsonError(DEAD_LINK, 404);

  return NextResponse.json({
    purpose: link.purpose,
    fullName: link.holder.fullName,
    email: link.holder.email,
    expiresAt: link.expiresAt.toISOString(),
  });
}
