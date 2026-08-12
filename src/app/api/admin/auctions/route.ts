import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, parsePaging, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { getSettings } from '@/lib/settings';
import { round2, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('auctions', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('q') || undefined;
  const { skip, take, page, pageSize } = parsePaging(req);

  const where: any = {
    ...(status ? { status } : {}),
    ...(search
      ? { OR: [{ title: { contains: search } }, { code: { contains: search } }] }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { category: { select: { name: true } }, item: { select: { name: true } } },
    }),
    prisma.auction.count({ where }),
  ]);

  return NextResponse.json({
    page,
    pageSize,
    total,
    auctions: rows.map((a) => ({
      id: a.id,
      code: a.code,
      title: a.title,
      status: a.status,
      category: a.category.name,
      item: a.item.name,
      bidFee: toNum(a.bidFee),
      bidCount: a.bidCount,
      bidderCount: a.bidderCount,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
    })),
  });
}

/** Generates the next public auction code, e.g. 185 → 186. */
async function nextAuctionCode(): Promise<string> {
  const latest = await prisma.auction.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { code: true },
  });
  const parsed = Number(latest?.code);
  const next = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 101;

  // Codes are unique; skip forward if an operator already claimed this one.
  let candidate = next;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const clash = await prisma.auction.findUnique({ where: { code: String(candidate) } });
    if (!clash) return String(candidate);
    candidate += 1;
  }
  return `A${Date.now().toString().slice(-8)}`;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('auctions', 'create');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const body = await req.json().catch(() => ({}));
  const settings = await getSettings();

  const itemId = String(body.itemId || '');
  const title = String(body.title || '').trim();
  if (!itemId) return jsonError('Select an item to auction.', 400);
  if (!title) return jsonError('Title is required.', 400);

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError('The selected item does not exist.', 404);

  const startAt = body.startAt ? new Date(body.startAt) : new Date();
  const endAt = body.endAt
    ? new Date(body.endAt)
    : new Date(
        startAt.getTime() +
          (Number(settings['bidding.defaultDurationDays']) || 10) * 86_400_000
      );

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return jsonError('Start and end times must be valid dates.', 400);
  }
  if (endAt <= startAt) return jsonError('The end time must be after the start time.', 400);

  const bidFee = round2(Number(body.bidFee ?? settings['bidding.defaultBidFee']));
  const minBidAmount = round2(Number(body.minBidAmount ?? settings['bidding.defaultMinBid']));
  const maxBidAmount = round2(Number(body.maxBidAmount ?? settings['bidding.defaultMaxBid']));
  const bidStep = round2(Number(body.bidStep ?? settings['bidding.defaultBidStep']));
  const maxBidsPerUser = Math.trunc(
    Number(body.maxBidsPerUser ?? settings['bidding.defaultMaxBidsPerUser'])
  );

  if (!(bidFee >= 0)) return jsonError('Bid fee must be zero or more.', 400);
  if (!(minBidAmount > 0)) return jsonError('Minimum bid must be greater than zero.', 400);
  if (!(maxBidAmount > minBidAmount)) {
    return jsonError('Maximum bid must be greater than the minimum bid.', 400);
  }
  if (!(bidStep > 0)) return jsonError('Bid increment must be greater than zero.', 400);
  if (!(maxBidsPerUser >= 1)) return jsonError('Max bids per bidder must be at least 1.', 400);

  const code = body.code ? String(body.code).trim() : await nextAuctionCode();
  const existing = await prisma.auction.findUnique({ where: { code } });
  if (existing) return jsonError(`Auction code ${code} is already in use.`, 409);

  const auction = await prisma.auction.create({
    data: {
      code,
      title,
      titleAm: body.titleAm ? String(body.titleAm) : undefined,
      subtitle: body.subtitle ? String(body.subtitle) : undefined,
      itemId,
      categoryId: item.categoryId,
      bidFee,
      minBidAmount,
      maxBidAmount,
      bidStep,
      maxBidsPerUser,
      currency: String(settings['platform.currency'] || 'ETB'),
      startAt,
      endAt,
      autoExtendMinutes: Math.max(
        0,
        Math.trunc(
          Number(body.autoExtendMinutes ?? settings['bidding.defaultAutoExtendMinutes'])
        ) || 0
      ),
      featured: Boolean(body.featured),
      displayOrder: Math.trunc(Number(body.displayOrder) || 0),
      termsId: body.termsId ? String(body.termsId) : undefined,
      status: 'DRAFT',
      createdById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUCTION_CREATED',
    entity: 'Auction',
    entityId: auction.id,
    details: { code, title, bidFee, minBidAmount, maxBidAmount, maxBidsPerUser },
  });

  return NextResponse.json({ id: auction.id, code: auction.code }, { status: 201 });
}
