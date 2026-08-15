import prisma from './prisma';
import { getSettings } from './settings';
import { touchAuctionLifecycle } from './maintenance';
import { carriedBidsRemaining, reauctionEligibility } from './reauction';
import { participantEligibility } from './eligibility';
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
  /** 0 = unlimited. Bidding closes once this many bids are in. */
  maxTotalBids: number;
  currency: string;
  startAt: string;
  endAt: string;
  bidCount: number | null;
  viewCount: number | null;
  featured: boolean;
  /** 0 for an original auction, 1+ for each re-run of it. */
  reauctionRound: number;
  reauctionAllowNewBidders: boolean;
  reauctionAllowPreviousBidders: boolean;
  /** Code of the round this one re-runs, so the app can explain where it came from. */
  parentCode: string | null;
  /** Open only to an invited list of phone numbers. */
  restricted: boolean;
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
    maxTotalBids: auction.maxTotalBids,
    currency: auction.currency,
    startAt: auction.startAt.toISOString(),
    endAt: auction.endAt.toISOString(),
    bidCount: settings['reveal.showBidCount'] ? auction.bidCount : null,
    viewCount: settings['reveal.showViewCount'] ? auction.viewCount : null,
    featured: auction.featured,
    reauctionRound: auction.reauctionRound,
    reauctionAllowNewBidders: auction.reauctionAllowNewBidders,
    reauctionAllowPreviousBidders: auction.reauctionAllowPreviousBidders,
    parentCode: auction.parentAuction?.code ?? null,
    restricted: auction.eligibilityMode === 'RESTRICTED',
  };
}

const auctionInclude = {
  item: { select: { images: true, description: true, retailPrice: true } },
  category: { select: { name: true } },
  parentAuction: { select: { code: true } },
} as const;

export interface BrowseOptions {
  categoryId?: string;
  search?: string;
  status?: 'LIVE' | 'ENDING_SOON' | 'ENDED' | 'ALL';
  take?: number;
  skip?: number;
}

export async function browseAuctions(options: BrowseOptions = {}) {
  await touchAuctionLifecycle();
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
  await touchAuctionLifecycle();
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
  await touchAuctionLifecycle();
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

export interface PublicTerms {
  title: string;
  contentEn: string;
  contentAm: string | null;
}

/**
 * The terms a bid on this auction is placed under: the version attached to the
 * auction when there is one, otherwise the platform's active version.
 *
 * The bid form has to show these before it will take a bid, and it is rendered
 * from list cards too, where the auction was loaded without its terms.
 */
export async function getTermsForAuction(auctionId?: string): Promise<PublicTerms | null> {
  const select = { title: true, contentEn: true, contentAm: true } as const;

  if (auctionId) {
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      select: { terms: { select } },
    });
    if (auction?.terms) return auction.terms;
  }

  return prisma.termsAndConditions.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
    select,
  });
}

function maskPhoneLocal(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-2)}`;
}

export interface BidderAuctionContext {
  /** Bids already paid for in an earlier round that this bidder can still spend here. */
  carriedBids: number;
  /** The bidder is allowed to bid in this round at all. */
  eligible: boolean;
  eligibilityReason: string | null;
  /** They bid in an earlier round of this chain. */
  returning: boolean;
}

/**
 * What this auction means for one bidder: whether they may take part at all,
 * and how many of their paid bids came with them from an earlier round. Only
 * the mini-app calls this, and only for the bidder it belongs to.
 *
 * Both gates the bid endpoint applies are evaluated here, so a bidder who
 * cannot bid is told on the page rather than after filling the form in.
 */
export async function getBidderAuctionContext(
  bidderId: string,
  auctionId: string
): Promise<BidderAuctionContext> {
  const [auction, bidder] = await Promise.all([
    prisma.auction.findUnique({
      where: { id: auctionId },
      select: {
        id: true,
        eligibilityMode: true,
        originalAuctionId: true,
        reauctionRound: true,
        reauctionAllowNewBidders: true,
        reauctionAllowPreviousBidders: true,
      },
    }),
    prisma.bidder.findUnique({ where: { id: bidderId }, select: { phoneNumber: true } }),
  ]);

  const open = { carriedBids: 0, eligible: true, eligibilityReason: null, returning: false };
  if (!auction) return open;

  // The invite list is the harder gate and is checked first: someone who is not
  // on it needs to hear that, not a re-auction rule they could never satisfy.
  if (bidder) {
    const invited = await participantEligibility(auction, bidder.phoneNumber);
    if (!invited.eligible) {
      return {
        carriedBids: 0,
        eligible: false,
        eligibilityReason: invited.reason ?? null,
        returning: false,
      };
    }
  }

  if (auction.reauctionRound === 0) return open;

  const [carriedBids, participation] = await Promise.all([
    carriedBidsRemaining(bidderId, auctionId),
    reauctionEligibility(auction, bidderId),
  ]);

  return {
    carriedBids,
    eligible: participation.eligible,
    eligibilityReason: participation.reason ?? null,
    returning: participation.returning,
  };
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
      carriedOver: true,
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
    carriedOver: b.carriedOver,
    status: b.status,
    sequence: b.sequence,
    createdAt: b.createdAt.toISOString(),
    isUnique: b.isUnique,
    rank: b.rankAtSettlement,
  }));
}
