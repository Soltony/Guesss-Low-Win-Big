import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { diffFields } from '@/lib/approvals';
import { REAUCTION_FIELDS, parseReauctionConfig } from '@/lib/reauction';
import { participantCount } from '@/lib/eligibility';
import { ELIGIBILITY_MODES, type EligibilityMode } from '@/lib/types';
import { round2, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('auctions', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    include: {
      item: true,
      category: true,
      winner: { include: { bidder: true } },
    },
  });
  if (!auction) return jsonError('Auction not found', 404);

  return NextResponse.json({
    ...auction,
    bidFee: toNum(auction.bidFee),
    minBidAmount: toNum(auction.minBidAmount),
    maxBidAmount: toNum(auction.maxBidAmount),
    bidStep: toNum(auction.bidStep),
  });
}

/** Editable fields. Economics are locked once bidding has started. */
const EDITABLE_ALWAYS = ['title', 'titleAm', 'subtitle', 'featured', 'displayOrder', 'termsId'];
const EDITABLE_BEFORE_BIDS = [
  'bidFee',
  'minBidAmount',
  'maxBidAmount',
  'bidStep',
  'maxBidsPerUser',
  'maxTotalBids',
  'startAt',
  'endAt',
  'autoExtendMinutes',
  'itemId',
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('auctions', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({ where: { id } });
  if (!auction) return jsonError('Auction not found', 404);

  if (auction.status === 'SETTLED' || auction.status === 'CANCELLED') {
    return jsonError(`A ${auction.status.toLowerCase()} auction cannot be edited.`, 409);
  }

  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;
  const hasBids = auction.bidCount > 0;

  const data: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};

  // Who the auction admits. Editable while it runs — unlike the money rules, it
  // cannot re-price a bid that was already placed. Restricting an auction that
  // is already live can still strand bidders who have paid, so the admin shows
  // how many that would be before the switch is thrown.
  if (body.eligibilityMode !== undefined) {
    const mode = String(body.eligibilityMode);
    if (!ELIGIBILITY_MODES.includes(mode as EligibilityMode)) {
      return jsonError(`Participation mode must be one of: ${ELIGIBILITY_MODES.join(', ')}.`, 400);
    }
    if (mode === 'RESTRICTED') {
      const listed = await participantCount(id);
      if (listed === 0) {
        return jsonError(
          'Upload the list of eligible participants before restricting this auction — an empty list would let nobody bid.',
          400
        );
      }
    }
    if (mode !== auction.eligibilityMode) {
      previous.eligibilityMode = auction.eligibilityMode;
      data.eligibilityMode = mode;
    }
  }

  for (const field of EDITABLE_ALWAYS) {
    if (body[field] === undefined) continue;
    previous[field] = (auction as any)[field];
    data[field] =
      field === 'featured'
        ? Boolean(body[field])
        : field === 'displayOrder'
          ? Math.trunc(Number(body[field]) || 0)
          : body[field] === null || body[field] === ''
            ? null
            : String(body[field]);
  }

  for (const field of EDITABLE_BEFORE_BIDS) {
    if (body[field] === undefined) continue;

    // Changing the money rules mid-auction would retroactively invalidate bids
    // that were already paid for under the old terms.
    if (hasBids) {
      return jsonError(
        `"${field}" cannot be changed once bids have been placed. Cancel the auction instead.`,
        409
      );
    }

    previous[field] = (auction as any)[field];

    if (field === 'startAt' || field === 'endAt') {
      const date = new Date(body[field]);
      if (Number.isNaN(date.getTime())) return jsonError(`${field} must be a valid date.`, 400);
      data[field] = date;
    } else if (
      field === 'maxBidsPerUser' ||
      field === 'maxTotalBids' ||
      field === 'autoExtendMinutes'
    ) {
      data[field] = Math.max(0, Math.trunc(Number(body[field]) || 0));
    } else if (field === 'itemId') {
      const item = await prisma.item.findUnique({ where: { id: String(body[field]) } });
      if (!item) return jsonError('The selected item does not exist.', 404);
      data.itemId = item.id;
      data.categoryId = item.categoryId;
    } else {
      data[field] = round2(Number(body[field]));
    }
  }

  // Re-auction rules stay editable while bids are live: switching a re-run on
  // only ever gives bidders a second round on fees they have already paid, so
  // it cannot re-price a bid the way the money rules above would.
  if (REAUCTION_FIELDS.some((field) => body[field] !== undefined)) {
    const parsed = parseReauctionConfig(body, auction);
    if ('error' in parsed) return jsonError(parsed.error, 400);
    for (const field of REAUCTION_FIELDS) {
      if (parsed.config[field] === auction[field]) continue;
      previous[field] = auction[field];
      data[field] = parsed.config[field];
    }
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  const start = (data.startAt as Date) ?? auction.startAt;
  const end = (data.endAt as Date) ?? auction.endAt;
  if (end <= start) return jsonError('The end time must be after the start time.', 400);

  const min = data.minBidAmount !== undefined ? Number(data.minBidAmount) : toNum(auction.minBidAmount);
  const max = data.maxBidAmount !== undefined ? Number(data.maxBidAmount) : toNum(auction.maxBidAmount);
  if (max <= min) return jsonError('Maximum bid must be greater than the minimum bid.', 400);

  const perBidder =
    data.maxBidsPerUser !== undefined ? Number(data.maxBidsPerUser) : auction.maxBidsPerUser;
  const perAuction =
    data.maxTotalBids !== undefined ? Number(data.maxTotalBids) : auction.maxTotalBids;
  if (perBidder < 1) return jsonError('Max bids per bidder must be at least 1.', 400);
  if (perAuction > 0 && perAuction < perBidder) {
    return jsonError(
      'Max bids per auction cannot be lower than the per-bidder limit — one bidder would exhaust the auction.',
      400
    );
  }

  const updated = await prisma.auction.update({ where: { id }, data });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUCTION_UPDATED',
    entity: 'Auction',
    entityId: id,
    details: { changedFields: diffFields(previous, data as any), previous, next: data },
  });

  return NextResponse.json({ id: updated.id, ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('auctions', 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const auction = await prisma.auction.findUnique({ where: { id } });
  if (!auction) return jsonError('Auction not found', 404);

  // Anything that has been public or taken money is cancelled, never deleted,
  // so the bid and payment history stays intact.
  if (auction.status !== 'DRAFT' || auction.bidCount > 0) {
    return jsonError(
      'Only draft auctions with no bids can be deleted. Cancel this auction instead.',
      409
    );
  }

  await prisma.auction.delete({ where: { id } });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUCTION_DELETED',
    entity: 'Auction',
    entityId: id,
    details: { code: auction.code, title: auction.title },
  });

  return NextResponse.json({ ok: true });
}
