import { NextRequest, NextResponse } from 'next/server';
import { MiniAppConnectError, connectMiniAppSession } from '@/lib/miniapp-connect';
import { clientMeta, jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the super-app token for a HowLow bidder session cookie.
 * Called by /connect once the webview hands us the Authorization header.
 */
export async function POST(req: NextRequest) {
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
    const result = await connectMiniAppSession(superAppToken, clientMeta(req));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MiniAppConnectError) {
      return jsonError(error.message, error.status);
    }
    console.error('[auth/connect] unexpected failure', error);
    return jsonError('Could not establish a session. Please reopen the app.', 500);
  }
}
