import { NextRequest, NextResponse } from 'next/server';
import { getBidderSession } from '@/lib/session';
import { jsonError, readJsonBody } from '@/lib/api';
import { popupAdsForBidder, recordAdClick, recordAdView } from '@/lib/ads';

export const dynamic = 'force-dynamic';

/** Popups the signed-in bidder is due to see on this visit. */
export async function GET() {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const result = await popupAdsForBidder({
    bidderId: session.bidderId,
    isTest: session.isTest,
    sessionId: session.sid,
  });

  return NextResponse.json(result);
}

/**
 * Records what the bidder did with a card: `view` when it reaches the screen,
 * `click` when they tap through. Views drive the frequency cap, so each card in
 * a queue reports its own rather than the whole batch counting on delivery.
 */
export async function POST(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const adId = String(body?.adId || '').trim();
  if (!adId) return jsonError('Ad id is required.', 400);

  const event = body?.event === 'view' ? 'view' : 'click';
  const recorded =
    event === 'view'
      ? await recordAdView(adId, session.bidderId)
      : await recordAdClick(adId, session.bidderId);
  if (!recorded) return jsonError('Ad not found', 404);

  return NextResponse.json({ ok: true });
}
