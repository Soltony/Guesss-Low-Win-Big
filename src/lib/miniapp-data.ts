import prisma from './prisma';
import { getSettings } from './settings';
import { syncAuctionLifecycle } from './auction-engine';
import { firstImage, toNum } from './format';
import type { AuctionStatus } from './types';

/**
 * Read models for the customer mini-app.
 *
 * Everything here is scrubbed of information that could leak the bid
 * distribution: no amounts, no per-amount counts, no other bidders' data.
 */

export interface PublicAuction {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  status: AuctionStatus;
  imageUrl: string | null;
  images: string[];
  description: string;
  categoryId: string;
  categoryName: string;
  retailPrice: number;
  bidFee: number;
  minBidAmount: number;
  maxBidAmount: number;
  bidStep: number;
  maxBidsPerUser: number;
  currency: string;
  startAt: string;
  endAt: string;
  bidCount: number | null;
  viewCount: number | null;
  featured: boolean;
}

const PUBLIC_STATUSES: AuctionStatus[] = ['SCHEDULED', 'LIVE', 'ENDED', 'SETTLED'];

function mapAuction(
  auction: any,
  settings: Record<string, string | number | boolean>
): PublicAuction {
  const images = (() => {
    try {
      const parsed = JSON.parse(auction.item?.images || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return {
    id: auction.id,
    code: auction.code,
    title: auction.title,
    subtitle: auction.subtitle,
    status: auction.status,
    imageUrl: images[0] ?? firstImage(auction.item?.images),
    images,
    description: auction.item?.description ?? '',
    categoryId: auction.categoryId,
    categoryName: auction.category?.name ?? '',
    retailPrice: toNum(auction.item?.retailPrice),
    bidFee: toNum(auction.bidFee),
    minBidAmount: toNum(auction.minBidAmount),
    maxBidAmount: toNum(auction.maxBidAmount),
    bidStep: toNum(auction.bidStep),
    maxBidsPerUser: auction.maxBidsPerUser,
    currency: auction.currency,
    startAt: auction.startAt.toISOString(),
    endAt: auction.endAt.toISOString(),
    bidCount: settings['reveal.showBidCount'] ? auction.bidCount : null,
    viewCount: settings['reveal.showViewCount'] ? auction.viewCount : null,
    featured: auction.featured,
  };
}

const auctionInclude = {
  item: { select: { images: true, description: true, retailPrice: true } },
  category: { select: { name: true } },
} as const;

export interface BrowseOptions {
  categoryId?: string;
  search?: string;
  status?: 'LIVE' | 'ENDING_SOON' | 'ENDED' | 'ALL';
  take?: number;
  skip?: number;
}

export async function browseAuctions(options: BrowseOptions = {}) {
  await syncAuctionLifecycle();
  const settings = await getSettings();
  const take = Math.min(60, options.take ?? 24);

  const endingSoonHours = Number(settings['bidding.endingSoonHours']) || 24;
  const statusFilter = options.status ?? 'ALL';

  const where: any = {
    status: { in: PUBLIC_STATUSES },
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options.search
      ? {
          OR: [
            { title: { contains: options.search } },
            { code: { contains: options.search } },
          ],
        }
      : {}),
  };

  if (statusFilter === 'LIVE') where.status = 'LIVE';
  if (statusFilter === 'ENDED') where.status = { in: ['ENDED', 'SETTLED'] };
  if (statusFilter === 'ENDING_SOON') {
    where.status = 'LIVE';
    where.endAt = { lte: new Date(Date.now() + endingSoonHours * 60 * 60 * 1000) };
  }

  const [rows, total] = await Promise.all([
    prisma.auction.findMany({
      where,
      include: auctionInclude,
      orderBy: [{ featured: 'desc' }, { displayOrder: 'asc' }, { endAt: 'asc' }],
      take,
      skip: options.skip ?? 0,
    }),
    prisma.auction.count({ where }),
  ]);

  return { auctions: rows.map((a) => mapAuction(a, settings)), total };
}

export async function getHomeData() {
  await syncAuctionLifecycle();
  const settings = await getSettings();
  const endingSoonHours = Number(settings['bidding.endingSoonHours']) || 24;

  const [banners, categories, featured, endingSoon, recentWinners, stats] = await Promise.all([
    prisma.banner.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ startAt: null }, { startAt: { lte: new Date() } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: new Date() } }] }],
      },
      orderBy: { displayOrder: 'asc' },
      take: 5,
    }),
    prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true, nameAm: true, slug: true, imageUrl: true, icon: true },
    }),
    prisma.auction.findMany({
      where: { status: 'LIVE', featured: true },
      include: auctionInclude,
      orderBy: [{ displayOrder: 'asc' }, { endAt: 'asc' }],
      take: 8,
    }),
    prisma.auction.findMany({
      where: {
        status: 'LIVE',
        endAt: { lte: new Date(Date.now() + endingSoonHours * 60 * 60 * 1000) },
      },
      include: auctionInclude,
      orderBy: { endAt: 'asc' },
      take: 8,
    }),
    prisma.winner.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        bidder: { select: { phoneNumber: true, fullName: true } },
        auction: {
          select: { code: true, title: true, currency: true, item: { select: { images: true } } },
        },
      },
    }),
    getPlatformStats(),
  ]);

  return {
    settings,
    banners: banners.map((b) => ({
      id: b.id,
      title: b.title,
      titleAm: b.titleAm,
      subtitle: b.subtitle,
      imageUrl: b.imageUrl,
      linkUrl: b.linkUrl,
    })),
    categories,
    featured: featured.map((a) => mapAuction(a, settings)),
    endingSoon: endingSoon.map((a) => mapAuction(a, settings)),
    recentWinners: recentWinners.map((w) => ({
      id: w.id,
      title: w.auction.title,
      code: w.auction.code,
      amount: toNum(w.amount),
      currency: w.auction.currency,
      imageUrl: firstImage(w.auction.item.images),
      winner: w.bidder.fullName || w.bidder.phoneNumber,
      settledAt: w.createdAt.toISOString(),
    })),
    stats,
  };
}

export async function getPlatformStats() {
  const [liveAuctions, totalBids, totalWinners] = await Promise.all([
    prisma.auction.count({ where: { status: 'LIVE' } }),
    prisma.bid.count({ where: { status: 'ACTIVE' } }),
    prisma.winner.count(),
  ]);
  return { liveAuctions, totalBids, totalWinners };
}

/** Auction detail by public code, with a best-effort view counter bump. */
export async function getAuctionByCode(code: string) {
  await syncAuctionLifecycle();
  const settings = await getSettings();

  const auction = await prisma.auction.findUnique({
    where: { code },
    include: {
      ...auctionInclude,
      terms: { select: { title: true, contentEn: true, contentAm: true } },
      winner: {
        include: { bidder: { select: { phoneNumber: true, fullName: true } } },
      },
    },
  });

  if (!auction || !PUBLIC_STATUSES.includes(auction.status as AuctionStatus)) return null;

  await prisma.auction
    .update({ where: { id: auction.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => null);

  const showPhone = Boolean(settings['winners.publishWinnerPhone']);

  return {
    ...mapAuction(auction, settings),
    terms: auction.terms,
    winner: auction.winner
      ? {
          amount: toNum(auction.winner.amount),
          status: auction.winner.status,
          displayName:
            auction.winner.bidder.fullName ||
            (showPhone ? maskPhoneLocal(auction.winner.bidder.phoneNumber) : 'A GuessLow bidder'),
        }
      : null,
    settled: auction.status === 'SETTLED',
  };
}

function maskPhoneLocal(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-2)}`;
}

/** The signed-in bidder's own bids on one auction. */
export async function getMyBidsForAuction(bidderId: string, auctionId: string) {
  const bids = await prisma.bid.findMany({
    where: { bidderId, auctionId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      feeAmount: true,
      status: true,
      sequence: true,
      createdAt: true,
      isUnique: true,
      rankAtSettlement: true,
    },
  });

  return bids.map((b) => ({
    id: b.id,
    amount: toNum(b.amount),
    feeAmount: toNum(b.feeAmount),
    status: b.status,
    sequence: b.sequence,
    createdAt: b.createdAt.toISOString(),
    isUnique: b.isUnique,
    rank: b.rankAtSettlement,
  }));
}
