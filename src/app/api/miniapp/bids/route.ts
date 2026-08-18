import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBidderSession } from '@/lib/session';
import { clientMeta, jsonError } from '@/lib/api';
import { BidRejected, placeBid } from '@/lib/bidding';
import { isRevealAllowed } from '@/lib/auction-engine';
import { tryDecryptBidAmount } from '@/lib/bid-crypto';
import { toNum } from '@/lib/format';
import { logSuperApp, newTrace, superAppDebugEnabled } from '@/lib/superapp-debug';

export const dynamic = 'force-dynamic';

/** The bidder's own bids, optionally scoped to one auction. */
export async function GET(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const url = new URL(req.url);
  const auctionId = url.searchParams.get('auctionId') || undefined;

  const bids = await prisma.bid.findMany({
    where: {
      bidderId: session.bidderId,
      ...(auctionId ? { auctionId } : {}),
      status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'FAILED', 'VOID'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      auction: {
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          endAt: true,
          currency: true,
          item: { select: { images: true } },
        },
      },
    },
  });

  // Uniqueness is only ever disclosed when the reveal policy allows it.
  const revealCache = new Map<string, boolean>();
  const out = [];
  for (const bid of bids) {
    let reveal = revealCache.get(bid.auctionId);
    if (reveal === undefined) {
      reveal = await isRevealAllowed(bid.auction);
      revealCache.set(bid.auctionId, reveal);
    }

    out.push({
      id: bid.id,
      auctionId: bid.auctionId,
      auctionCode: bid.auction.code,
      auctionTitle: bid.auction.title,
      auctionStatus: bid.auction.status,
      auctionEndAt: bid.auction.endAt.toISOString(),
      currency: bid.auction.currency,
      // Every row is the caller's own — the query is scoped to their bidder id
      // — and a bidder may always read the amounts they placed.
      amount: tryDecryptBidAmount(bid.amountCipher, {
        auctionId: bid.auctionId,
        bidderId: session.bidderId,
      }),
      feeAmount: toNum(bid.feeAmount),
      carriedOver: bid.carriedOver,
      status: bid.status,
      sequence: bid.sequence,
      createdAt: bid.createdAt.toISOString(),
      isUnique: reveal ? bid.isUnique : null,
      rank: reveal ? bid.rankAtSettlement : null,
      revealed: reveal,
    });
  }

  return NextResponse.json({ bids: out });
}

/** Places a bid: validates the rules, then charges the fee via the super app. */
export async function POST(req: NextRequest) {
  const session = await getBidderSession();
  if (!session) return jsonError('Not authenticated', 401);

  const body = await req.json().catch(() => ({}));
  const auctionId = String(body?.auctionId || '');
  const amount = Number(body?.amount);

  if (!auctionId) return jsonError('Auction is required.', 400);
  if (!Number.isFinite(amount)) return jsonError('Enter a valid bid amount.', 400);
  // The bid form asks for this on every bid; the rule is repeated here so no
  // bid can be registered — or a fee charged — without the acceptance.
  if (body?.acceptedTerms !== true) {
    return jsonError('You must accept the terms and conditions before placing a bid.', 400, {
      code: 'TERMS_NOT_ACCEPTED',
    });
  }

  const meta = clientMeta(req);
  const trace = newTrace();

  // The session's token is the one that will be signed. Logging its fingerprint
  // here is what makes it comparable with the one recorded at /connect.
  logSuperApp('BID ↥ POST /api/miniapp/bids', {
    trace,
    auctionId,
    amount,
    bidderId: session.bidderId,
    phone: session.phone,
    isTest: Boolean(session.isTest),
    token: session.superAppToken,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  try {
    const result = await placeBid({
      auctionId,
      bidderId: session.bidderId,
      amount,
      superAppToken: session.superAppToken,
      isTest: session.isTest,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    logSuperApp('BID ✓ 201 to the webview', { trace, ...result });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BidRejected) {
      logSuperApp('BID ✗ rejected', {
        trace,
        status: error.status,
        code: error.code,
        message: error.message,
        debug: error.debug,
      });
      // A phone in a webview has no console, so in debug mode the gateway's own
      // words travel back with the error instead of only reaching the terminal.
      return jsonError(error.message, error.status, {
        code: error.code,
        ...(superAppDebugEnabled() && error.debug ? { debug: error.debug } : {}),
      });
    }
    console.error('[miniapp/bids] unexpected failure', error);
    logSuperApp('BID ✗ unexpected failure', { trace, error: (error as Error)?.message });
    return jsonError('Could not place your bid. Please try again.', 500);
  }
}
