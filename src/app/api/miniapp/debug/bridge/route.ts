import { NextRequest, NextResponse } from 'next/server';
import { getBidderSession } from '@/lib/session';
import { jsonError, readJsonBody } from '@/lib/api';
import { logSuperApp, superAppDebugEnabled } from '@/lib/superapp-debug';

export const dynamic = 'force-dynamic';

/**
 * Echoes the native hand-off into the server log.
 *
 * The mini app runs in a webview on a phone, where no console can be read, so
 * whether the JS channel was found — and what the host exposes when it was not
 * — is posted here instead of vanishing. Debug builds only; silent otherwise.
 */
export async function POST(req: NextRequest) {
  if (!superAppDebugEnabled()) return NextResponse.json({ ok: true });

  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);

  logSuperApp('BRIDGE ↥ native hand-off reported by the webview', {
    bidderId: session.bidderId,
    phone: session.phone,
    ...body,
  });

  return NextResponse.json({ ok: true });
}
