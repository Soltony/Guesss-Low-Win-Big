import { NextRequest, NextResponse } from 'next/server';
import { MiniAppConnectError, connectMiniAppSession } from '@/lib/miniapp-connect';
import { clientMeta, enforceRateLimit, jsonError } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the super-app token for a GuessLow bidder session cookie.
 * Called by /connect once the webview hands us the Authorization header.
 */
export async function POST(req: NextRequest) {
  const meta = clientMeta(req);

  // Unauthenticated by definition — this is where a session is obtained — and
  // every call reaches the super app's token service, so it is both a brute
  // force target and a way to use us to flood a third party.
  const limited = enforceRateLimit('connect', meta.ipAddress, RATE_LIMITS.connect);
  if (limited) return limited;

  let superAppToken: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    superAppToken = body?.superAppToken || req.headers.get('authorization') || undefined;
  } catch {
    return jsonError('Invalid request body.', 400);
  }

  if (!superAppToken) {
    return jsonError('Super App token is missing.', 400);
  }

  try {
    const result = await connectMiniAppSession(superAppToken, meta);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MiniAppConnectError) {
      return jsonError(error.message, error.status);
    }
    console.error('[auth/connect] unexpected failure', error);
    return jsonError('Could not establish a session. Please reopen the app.', 500);
  }
}
