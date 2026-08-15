import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, parsePaging, requirePermission } from '@/lib/api';
import {
  clearParticipants,
  importParticipants,
  isRestricted,
  unlistedBidderCount,
} from '@/lib/eligibility';
import {
  applyListToAuction,
  attachedList,
  MAX_LIST_ENTRIES,
  ParticipantListError,
} from '@/lib/participant-lists';
import {
  emptyParseError,
  isUploadFailure,
  readParticipantUpload,
  toParticipantCsv,
} from '@/lib/participant-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The invited-participant list for one auction.
 *
 * GET    — page through the list, or export it as CSV with `?format=csv`
 * POST   — import a file, a pasted list, or a saved list from Content
 * DELETE — clear the list
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('auctions', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      title: true,
      eligibilityMode: true,
      sourceListId: true,
      participantsSyncedAt: true,
    },
  });
  if (!auction) return jsonError('Auction not found', 404);

  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.trim() || '';
  const where = {
    auctionId: id,
    ...(search
      ? {
          OR: [
            { phoneNumber: { contains: search.replace(/\D/g, '') || search } },
            { fullName: { contains: search } },
          ],
        }
      : {}),
  };

  if (url.searchParams.get('format') === 'csv') {
    const all = await prisma.auctionParticipant.findMany({
      where: { auctionId: id },
      orderBy: { createdAt: 'asc' },
      select: { phoneNumber: true, fullName: true, note: true },
    });

    return new NextResponse(toParticipantCsv(all), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="participants-${auction.code}.csv"`,
      },
    });
  }

  const { skip, take, page, pageSize } = parsePaging(req, 50);

  const [rows, total, listTotal, unlisted, sourceList] = await Promise.all([
    prisma.auctionParticipant.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take,
      include: { addedBy: { select: { fullName: true } } },
    }),
    prisma.auctionParticipant.count({ where }),
    prisma.auctionParticipant.count({ where: { auctionId: id } }),
    unlistedBidderCount(auction),
    attachedList(auction),
  ]);

  // Whether each invitee has actually turned up, resolved by phone rather than
  // by a stored link — the list is uploaded long before most of these people
  // have a bidder profile at all.
  const bidders = await prisma.bidder.findMany({
    where: { phoneNumber: { in: rows.map((row) => row.phoneNumber) } },
    select: { id: true, phoneNumber: true, fullName: true, status: true },
  });
  const byPhone = new Map(bidders.map((bidder) => [bidder.phoneNumber, bidder]));

  const bidCounts =
    bidders.length > 0
      ? await prisma.bid.groupBy({
          by: ['bidderId'],
          where: {
            auctionId: id,
            bidderId: { in: bidders.map((b) => b.id) },
            status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
          },
          _count: { _all: true },
        })
      : [];
  const bidsByBidder = new Map(bidCounts.map((row) => [row.bidderId, row._count._all]));

  return NextResponse.json({
    page,
    pageSize,
    total,
    listTotal,
    restricted: isRestricted(auction),
    unlistedBidders: unlisted,
    sourceList,
    participants: rows.map((row) => {
      const bidder = byPhone.get(row.phoneNumber);
      return {
        id: row.id,
        phoneNumber: row.phoneNumber,
        fullName: row.fullName,
        note: row.note,
        source: row.source,
        addedBy: row.addedBy?.fullName ?? null,
        createdAt: row.createdAt.toISOString(),
        registered: Boolean(bidder),
        bidderId: bidder?.id ?? null,
        bidderName: bidder?.fullName ?? null,
        bidderStatus: bidder?.status ?? null,
        bidsPlaced: bidder ? (bidsByBidder.get(bidder.id) ?? 0) : 0,
      };
    }),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('auctions', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { id: true, code: true, status: true, eligibilityMode: true },
  });
  if (!auction) return jsonError('Auction not found', 404);
  if (auction.status === 'SETTLED' || auction.status === 'CANCELLED') {
    return jsonError(
      `A ${auction.status.toLowerCase()} auction's participant list cannot be changed.`,
      409
    );
  }

  const actor = { id: user.id, fullName: user.fullName };
  const contentType = req.headers.get('content-type') || '';

  // Attaching a saved list from Content. Handled before the upload reader
  // because there is no file to read — the numbers are already in the database,
  // and copying them is what keeps this auction's roster independent of later
  // edits to that list.
  if (!contentType.includes('multipart/form-data')) {
    const preview = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof preview.listId === 'string' && preview.listId) {
      try {
        const applied = await applyListToAuction({
          auctionId: id,
          listId: preview.listId,
          mode: preview.mode === 'replace' ? 'replace' : 'append',
          actor,
        });

        return NextResponse.json({
          ok: true,
          restricted: await restrictAfterImport(auction, applied.total),
          ...applied,
          rejected: [],
          rejectedTotal: 0,
        });
      } catch (error) {
        if (error instanceof ParticipantListError) return jsonError(error.message, error.status);
        throw error;
      }
    }
  }

  const upload = await readParticipantUpload(req);
  if (isUploadFailure(upload)) return jsonError(upload.error, upload.status);
  const { parsed, mode, source } = upload;

  if (parsed.entries.length === 0) {
    const failure = emptyParseError(parsed);
    return jsonError(failure.error, failure.status, { rejected: failure.rejected });
  }
  if (parsed.entries.length > MAX_LIST_ENTRIES) {
    return jsonError(
      `That list holds ${parsed.entries.length.toLocaleString()} numbers. The limit is ${MAX_LIST_ENTRIES.toLocaleString()} per auction.`,
      413
    );
  }

  const summary = await importParticipants({
    auctionId: id,
    entries: parsed.entries,
    mode,
    source,
    actor,
    parsed,
  });

  // Replacing the roster from a file makes it a snapshot of nothing in
  // particular, so the auction stops claiming to come from a saved list.
  // Appending leaves the claim intact: the roster is still that list, plus
  // whoever was added on top of it.
  if (mode === 'replace') {
    await prisma.auction.update({
      where: { id },
      data: { sourceListId: null, participantsSyncedAt: null },
    });
  }

  return NextResponse.json({
    ok: true,
    restricted: await restrictAfterImport(auction, summary.total),
    ...summary,
    // Only the first few are worth showing; the rest would fill the screen.
    rejected: summary.rejected.slice(0, 20),
    rejectedTotal: summary.rejected.length,
  });
}

/**
 * A list is only meaningful once the auction is actually restricted; switching
 * it on after a successful import is what the operator meant by supplying one.
 */
async function restrictAfterImport(
  auction: { id: string; eligibilityMode: string },
  total: number
): Promise<boolean> {
  if (isRestricted(auction)) return true;
  if (total === 0) return false;

  await prisma.auction.update({
    where: { id: auction.id },
    data: { eligibilityMode: 'RESTRICTED' },
  });
  return true;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('auctions', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!auction) return jsonError('Auction not found', 404);
  if (auction.status === 'SETTLED' || auction.status === 'CANCELLED') {
    return jsonError(
      `A ${auction.status.toLowerCase()} auction's participant list cannot be changed.`,
      409
    );
  }

  const removed = await clearParticipants(id, { id: user.id, fullName: user.fullName });

  // An empty list on a restricted auction would turn everyone away, which is
  // never what clearing it means — clearing is how you reopen an auction. The
  // saved-list link goes with it: there is no longer a roster for it to explain.
  await prisma.auction.update({
    where: { id },
    data: { eligibilityMode: 'OPEN', sourceListId: null, participantsSyncedAt: null },
  });

  return NextResponse.json({ ok: true, removed, restricted: false });
}
