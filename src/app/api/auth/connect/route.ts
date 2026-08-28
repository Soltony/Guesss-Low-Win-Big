import { NextRequest, NextResponse } from 'next/server';
import { MiniAppConnectError, connectMiniAppSession } from '@/lib/miniapp-connect';
import { clientMeta, jsonError, readJsonBody, tooManyRequests } from '@/lib/api';
import { headerMap, logSuperApp } from '@/lib/superapp-debug';
import { consumeRateLimit } from '@/lib/rate-limit';
import { addressKey } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the super-app token for a GuessLow bidder session cookie.
 * Called by /connect once the webview hands us the Authorization header.
 */
export async function POST(req: NextRequest) {
  // This endpoint mints a session from a supplied token, so it is worth
  // replaying candidate tokens against. Generous enough that a flaky webview
  // retrying on its own is never affected.
  const limit = consumeRateLimit('sessionExchange', addressKey(req.headers));
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let superAppToken: string | undefined;
  let source: string | undefined;

  try {
    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;
    superAppToken = body?.superAppToken || req.headers.get('authorization') || undefined;
    source = body?.superAppToken
      ? 'request body'
      : req.headers.get('authorization')
        ? 'authorization header'
        : undefined;
  } catch {
    return jsonError('Invalid request body.', 400);
  }

  logSuperApp('CONNECT ↥ POST /api/auth/connect', {
    tokenSource: source ?? 'none',
    headers: headerMap(req.headers),
  });

  if (!superAppToken) {
    logSuperApp('CONNECT ✗ no super-app token on the request');
    return jsonError('Super App token is missing.', 400);
  }

  try {
    const result = await connectMiniAppSession(superAppToken, clientMeta(req));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MiniAppConnectError) {
      logSuperApp('CONNECT ✗ responding to the webview', {
        status: error.status,
        message: error.message,
      });
      return jsonError(error.message, error.status);
    }
    console.error('[auth/connect] unexpected failure', error);
    return jsonError('Could not establish a session. Please reopen the app.', 500);
  }
}
