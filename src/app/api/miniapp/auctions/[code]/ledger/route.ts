import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession } from '@/lib/session';
import { handle, jsonError } from '@/lib/api';
import { getLedgerOverview, getLedgerRows, type LedgerScope } from '@/lib/bid-ledger';

export const dynamic = 'force-dynamic';

const SCOPES: LedgerScope[] = ['proof', 'all', 'mine'];

/** A query-string amount, or null when it is absent or not a number. */
function amountParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Pages the published bid ledger for one auction.
 *
 * Open to anyone who can reach the mini-app, because the ledger only exists
 * for auctions that have settled — `getLedgerRows` re-checks that itself and
 * returns nothing for a round that is still running, whatever is asked for
 * here. A bidder session is read when there is one, purely so the reader's own
 * rows can be marked; the response is identical without it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;

    const auction = await prisma.auction.findUnique({
      where: { code },
      select: { id: true, status: true, currency: true },
    });
    if (!auction) return jsonError('Auction not found', 404);

    const session = await getBidderSession();
    const url = new URL(req.url);

    // Lists render the sheet from a card, where paying for an overview per
    // auction would be absurd — so the summary is fetched here, once, when a
    // reader actually opens one. The detail page still passes its own in.
    if (url.searchParams.get('mode') === 'overview') {
      return getLedgerOverview(auction);
    }

    const requested = url.searchParams.get('scope');
    const scope = SCOPES.includes(requested as LedgerScope) ? (requested as LedgerScope) : 'all';

    return getLedgerRows(auction, {
      scope,
      cursor: amountParam(url.searchParams.get('cursor')),
      amount: amountParam(url.searchParams.get('amount')),
      expandAmount: amountParam(url.searchParams.get('expand')),
      limit: Number(url.searchParams.get('limit')) || undefined,
      viewerBidderId: session?.bidderId ?? null,
    });
  });
}
