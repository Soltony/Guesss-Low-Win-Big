import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, parsePaging, requirePermission } from '@/lib/api';
import {
  clearParticipants,
  importParticipants,
  isRestricted,
  parseParticipantText,
  readParticipantFile,
  unlistedBidderCount,
  type ParsedList,
} from '@/lib/eligibility';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Uploads are lists of phone numbers, so a few hundred KB is already generous. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Guards against an operator pasting an entire customer database by mistake. */
const MAX_ENTRIES = 50_000;

const ACCEPTED_EXTENSIONS = ['.csv', '.txt', '.tsv', '.xlsx', '.xlsm'];

/**
 * The invited-participant list for one auction.
 *
 * GET    — page through the list, or export it as CSV with `?format=csv`
 * POST   — import a file or a pasted list, replacing or appending
 * DELETE — clear the list
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('auctions', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { id: true, code: true, title: true, eligibilityMode: true },
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

    const csv = [
      'phone,name,note',
      ...all.map((row) =>
        [row.phoneNumber, row.fullName ?? '', row.note ?? ''].map(csvCell).join(',')
      ),
      '',
    ].join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="participants-${auction.code}.csv"`,
      },
    });
  }

  const { skip, take, page, pageSize } = parsePaging(req, 50);

  const [rows, total, listTotal, unlisted] = await Promise.all([
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

  let parsed: ParsedList;
  let mode: 'replace' | 'append' = 'append';
  let source = 'UPLOAD';

  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Could not read the uploaded file.', 400);
    }

    const file = form.get('file');
    if (!file || typeof file === 'string') return jsonError('No file was supplied.', 400);
    if (file.size === 0) return jsonError('The selected file is empty.', 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(
        `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB.`,
        413
      );
    }

    const name = 'name' in file ? String(file.name).toLowerCase() : '';
    if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      return jsonError('Upload a .csv, .txt or .xlsx file.', 415);
    }

    if (form.get('mode') === 'replace') mode = 'replace';

    try {
      parsed = await readParticipantFile(file);
    } catch (error) {
      console.error('[participants] parse failed', error);
      return jsonError('The file could not be read. Save it as CSV and try again.', 400);
    }
  } else {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    if (body.mode === 'replace') mode = 'replace';
    source = 'MANUAL';

    if (typeof body.text === 'string') {
      parsed = parseParticipantText(body.text);
    } else if (Array.isArray(body.entries)) {
      // Entries arrive as raw rows and go through the same parser, so a number
      // typed into the admin is normalised exactly like an uploaded one.
      parsed = parseParticipantText(
        body.entries
          .map((entry: unknown) => {
            if (typeof entry === 'string') return entry;
            const row = entry as { phoneNumber?: string; phone?: string; fullName?: string; note?: string };
            return [row.phoneNumber ?? row.phone ?? '', row.fullName ?? '', row.note ?? '']
              .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
              .join(',');
          })
          .join('\n')
      );
    } else {
      return jsonError('Supply a file, a list of numbers, or entries to add.', 400);
    }
  }

  if (parsed.entries.length === 0) {
    return jsonError(
      parsed.rejected.length > 0
        ? `No usable phone numbers were found — ${parsed.rejected.length} row(s) could not be read.`
        : 'No phone numbers were found in what you supplied.',
      400,
      { rejected: parsed.rejected.slice(0, 20) }
    );
  }
  if (parsed.entries.length > MAX_ENTRIES) {
    return jsonError(
      `That list holds ${parsed.entries.length.toLocaleString()} numbers. The limit is ${MAX_ENTRIES.toLocaleString()} per auction.`,
      413
    );
  }

  const summary = await importParticipants({
    auctionId: id,
    entries: parsed.entries,
    mode,
    source,
    actor: { id: user.id, fullName: user.fullName },
    parsed,
  });

  // An uploaded list is only meaningful once the auction is actually
  // restricted; switching it on here is what the operator meant by uploading.
  let restricted = isRestricted(auction);
  if (!restricted && summary.total > 0) {
    await prisma.auction.update({ where: { id }, data: { eligibilityMode: 'RESTRICTED' } });
    restricted = true;
  }

  return NextResponse.json({
    ok: true,
    restricted,
    ...summary,
    // Only the first few are worth showing; the rest would fill the screen.
    rejected: summary.rejected.slice(0, 20),
    rejectedTotal: summary.rejected.length,
  });
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
  // never what clearing it means — clearing is how you reopen an auction.
  await prisma.auction.update({ where: { id }, data: { eligibilityMode: 'OPEN' } });

  return NextResponse.json({ ok: true, removed, restricted: false });
}

/** Quotes a CSV field only when it has to be. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
