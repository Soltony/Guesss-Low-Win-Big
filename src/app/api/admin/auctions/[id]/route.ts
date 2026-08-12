import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { diffFields } from '@/lib/approvals';
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

  const body = await req.json().catch(() => ({}));
  const hasBids = auction.bidCount > 0;

  const data: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};

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
    } else if (field === 'maxBidsPerUser' || field === 'autoExtendMinutes') {
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

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  const start = (data.startAt as Date) ?? auction.startAt;
  const end = (data.endAt as Date) ?? auction.endAt;
  if (end <= start) return jsonError('The end time must be after the start time.', 400);

  const min = data.minBidAmount !== undefined ? Number(data.minBidAmount) : toNum(auction.minBidAmount);
  const max = data.maxBidAmount !== undefined ? Number(data.maxBidAmount) : toNum(auction.maxBidAmount);
  if (max <= min) return jsonError('Maximum bid must be greater than the minimum bid.', 400);

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
