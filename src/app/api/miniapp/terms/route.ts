import { NextRequest, NextResponse } from 'next/server';
import { getTermsForAuction } from '@/lib/miniapp-data';

export const dynamic = 'force-dynamic';

/**
 * The terms a bid is placed under, for the acceptance step in the bid form.
 *
 * Public on purpose: this is the same text the auction page and the profile
 * page already publish, and it has to be readable before a bid exists.
 */
export async function GET(req: NextRequest) {
  const auctionId = new URL(req.url).searchParams.get('auctionId') || undefined;
  const terms = await getTermsForAuction(auctionId);
  return NextResponse.json({ terms });
}
