import prisma from './prisma';
import { getSettings } from './settings';
import { maskPhone, toNum } from './format';

/**
 * The published bid ledger — the record that lets anyone check a settled
 * auction for themselves.
 *
 * A lowest-unique-bid result is only convincing if you can see the amounts it
 * was computed from: the winner won because every cheaper amount was matched
 * by a second bidder and cancelled out, and no summary can show that. So at
 * settlement the whole bid space is grouped by amount and written down, and
 * from then on the mini-app can render it without touching a ciphertext.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Nothing is published before the auction is SETTLED. That is the same
 *      boundary bid-visibility.ts draws, for the same reason — an ENDED
 *      auction can still be re-settled or rolled into a re-auction, so its bid
 *      space is still live information.
 *   2. Bidders are published masked, or not at all. `reveal.ledgerShowBidders`
 *      decides which; the counts alone already prove the result, so turning it
 *      off costs the reader nothing.
 */

/** Bids bucketed by their exact 2-decimal amount, so 2 and 2.00 are one bucket. */
export function groupByAmount<T extends { amount: number }>(bids: T[]): Map<string, T[]> {
  const byAmount = new Map<string, T[]>();
  for (const bid of bids) {
    const key = bid.amount.toFixed(2);
    const list = byAmount.get(key);
    if (list) list.push(bid);
    else byAmount.set(key, [bid]);
  }
  return byAmount;
}

export interface LedgerEntry {
  amount: number;
  bidCount: number;
  isUnique: boolean;
  /** Position among the unique amounts, 1 being the winner. Null when matched. */
  uniqueRank: number | null;
  /** One bidder id per bid, in the order the bids were placed. */
  bidderIds: string[];
}

/**
 * The shape of an auction's bid space, ready to persist.
 *
 * `rankings` is the full unique ranking from `rankUniqueBids`, not the trimmed
 * runner-up slice: every unique amount carries its own position, which is what
 * lets the sheet say "the 3rd-lowest unmatched bid" without re-deriving it.
 */
export function buildBidLedger(
  bids: { bidderId: string; amount: number }[],
  rankings: { amount: number; rank: number }[]
): LedgerEntry[] {
  const rankByAmount = new Map(rankings.map((r) => [r.amount.toFixed(2), r.rank]));

  const entries: LedgerEntry[] = [];
  for (const [key, list] of groupByAmount(bids)) {
    entries.push({
      amount: Number(key),
      bidCount: list.length,
      isUnique: list.length === 1,
      uniqueRank: rankByAmount.get(key) ?? null,
      bidderIds: list.map((bid) => bid.bidderId),
    });
  }

  entries.sort((a, b) => a.amount - b.amount);
  return entries;
}

// The insert is split rather than sent as one statement because SQL Server
// refuses any statement carrying more than 2100 parameters. Six columns per
// row puts the ceiling at 350 rows, and one auction's ledger is routinely
// larger than that — a 1-to-100 range bid in 0.01 steps is 9,900 amounts — so
// a single createMany would fail outright on exactly the busy auctions this
// feature exists for. 200 leaves headroom under the limit.
const INSERT_CHUNK = 200;

/**
 * Replaces an auction's published ledger.
 *
 * Called straight after settlement commits rather than from inside its
 * transaction: a bid space can run to thousands of amounts, and holding the
 * settlement transaction open for that long would risk timing out the part
 * that actually decides the winner. Settlement deletes the old rows inside its
 * transaction, so a failure here leaves the ledger unpublished rather than
 * stale — the sheet says so, and re-settling rebuilds it.
 */
export async function publishBidLedger(auctionId: string, entries: LedgerEntry[]) {
  await prisma.auctionLedgerEntry.deleteMany({ where: { auctionId } });

  for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
    const chunk = entries.slice(i, i + INSERT_CHUNK);
    await prisma.auctionLedgerEntry.createMany({
      data: chunk.map((entry) => ({
        auctionId,
        amount: entry.amount,
        bidCount: entry.bidCount,
        isUnique: entry.isUnique,
        uniqueRank: entry.uniqueRank,
        bidderIds: JSON.stringify(entry.bidderIds),
      })),
    });
  }

  return entries.length;
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

/** Bidders shown on a collapsed row before the reader asks for the rest. */
export const BIDDER_PREVIEW = 2;

/** Bars in the overview strip. Enough to show the shape, small enough to draw. */
const HISTOGRAM_BUCKETS = 72;

export type LedgerScope = 'proof' | 'all' | 'mine';

export interface HistogramBar {
  amount: number;
  bidCount: number;
  /** At least one amount in this bar went unmatched. */
  unique: boolean;
  /** This bar holds the winning amount. */
  winner: boolean;
}

export interface LedgerOverview {
  published: boolean;
  /** Masked bidder lists are being published alongside the counts. */
  showBidders: boolean;
  currency: string;
  /** Every confirmed bid on the auction. */
  totalBids: number;
  /** Bids that shared their amount with someone else, and so cancelled out. */
  matchedBids: number;
  /** Bids that were the only one at their amount. */
  uniqueBids: number;
  /** Distinct amounts anybody bid. */
  amountCount: number;
  lowestAmount: number | null;
  winningAmount: number | null;
  /** How many amounts below the winner were bid, and therefore all matched. */
  matchedBelowWinner: number;
  histogram: HistogramBar[];
}

export interface LedgerRow {
  amount: number;
  bidCount: number;
  isUnique: boolean;
  uniqueRank: number | null;
  /** The viewer holds a bid at this amount. */
  mine: boolean;
  /** Masked bidders. Empty when bidder publishing is off. */
  bidders: string[];
  /** Positions inside `bidders` that are the viewer's own bids. */
  mineIndexes: number[];
  /** `bidders` is a preview of a longer list. */
  truncated: boolean;
}

export interface LedgerPage {
  rows: LedgerRow[];
  /** Amount to pass back as `cursor` for the next page, or null at the end. */
  nextCursor: number | null;
}

export interface LedgerPolicy {
  published: boolean;
  showBidders: boolean;
}

/** Whether this auction's ledger may be read at all, and how much of it. */
export async function getLedgerPolicy(auction: { status: string }): Promise<LedgerPolicy> {
  const settings = await getSettings();
  const published = auction.status === 'SETTLED' && Boolean(settings['reveal.publishLedger']);
  return {
    published,
    showBidders: published && Boolean(settings['reveal.ledgerShowBidders']),
  };
}

/**
 * The headline numbers and the shape of the bid space.
 *
 * Every row is loaded, but only its four small columns — the bidder lists are
 * the bulk of the table and none of them are needed to count or to draw the
 * strip.
 */
export async function getLedgerOverview(auction: {
  id: string;
  status: string;
  currency: string;
}): Promise<LedgerOverview> {
  const policy = await getLedgerPolicy(auction);

  const empty: LedgerOverview = {
    published: false,
    showBidders: false,
    currency: auction.currency,
    totalBids: 0,
    matchedBids: 0,
    uniqueBids: 0,
    amountCount: 0,
    lowestAmount: null,
    winningAmount: null,
    matchedBelowWinner: 0,
    histogram: [],
  };

  if (!policy.published) return empty;

  const rows = await prisma.auctionLedgerEntry.findMany({
    where: { auctionId: auction.id },
    select: { amount: true, bidCount: true, isUnique: true, uniqueRank: true },
    orderBy: { amount: 'asc' },
  });
  if (rows.length === 0) return empty;

  const amounts = rows.map((row) => toNum(row.amount));

  let totalBids = 0;
  let uniqueBids = 0;
  let winningAmount: number | null = null;
  rows.forEach((row, index) => {
    totalBids += row.bidCount;
    if (row.isUnique) uniqueBids += 1;
    if (row.uniqueRank === 1) winningAmount = amounts[index];
  });

  const winner: number | null = winningAmount;
  const matchedBelowWinner =
    winner === null ? 0 : amounts.filter((amount) => amount < winner).length;

  return {
    published: true,
    showBidders: policy.showBidders,
    currency: auction.currency,
    totalBids,
    matchedBids: totalBids - uniqueBids,
    uniqueBids,
    amountCount: rows.length,
    lowestAmount: amounts[0],
    winningAmount: winner,
    matchedBelowWinner,
    histogram: buildHistogram(
      rows.map((row, index) => ({
        amount: amounts[index],
        bidCount: row.bidCount,
        isUnique: row.isUnique,
        isWinner: row.uniqueRank === 1,
      }))
    ),
  };
}

/**
 * Collapses the ledger to a fixed number of bars.
 *
 * Bucketing by position rather than by value keeps every bar equally wide on
 * screen no matter how the amounts are spread, which is what makes the run of
 * contested amounts at the bottom of the range readable at a glance.
 */
function buildHistogram(
  rows: { amount: number; bidCount: number; isUnique: boolean; isWinner: boolean }[]
): HistogramBar[] {
  if (rows.length <= HISTOGRAM_BUCKETS) {
    return rows.map((row) => ({
      amount: row.amount,
      bidCount: row.bidCount,
      unique: row.isUnique,
      winner: row.isWinner,
    }));
  }

  const size = Math.ceil(rows.length / HISTOGRAM_BUCKETS);
  const bars: HistogramBar[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const bucket = rows.slice(i, i + size);
    bars.push({
      amount: bucket[0].amount,
      bidCount: bucket.reduce((sum, row) => sum + row.bidCount, 0),
      unique: bucket.some((row) => row.isUnique),
      winner: bucket.some((row) => row.isWinner),
    });
  }
  return bars;
}

export interface LedgerQuery {
  scope?: LedgerScope;
  /** Return amounts strictly greater than this one. */
  cursor?: number | null;
  limit?: number;
  /** Jump straight to one amount, whatever the scope says. */
  amount?: number | null;
  /** Set when a signed-in bidder is reading, so their own rows can be marked. */
  viewerBidderId?: string | null;
  /** Publish every bidder on this row rather than the preview. */
  expandAmount?: number | null;
}

/**
 * One page of the ledger, ascending by amount.
 *
 * Paging on the amount itself rather than on an offset keeps the sheet stable
 * if an auction is re-settled while somebody is reading it, and lets the
 * "check an amount" box reuse exactly the same query.
 */
export async function getLedgerRows(
  auction: { id: string; status: string },
  query: LedgerQuery = {}
): Promise<LedgerPage> {
  const policy = await getLedgerPolicy(auction);
  if (!policy.published) return { rows: [], nextCursor: null };

  const scope = query.scope ?? 'all';
  const limit = Math.min(100, Math.max(1, query.limit ?? 40));
  const viewerId = query.viewerBidderId ?? null;

  const where: Record<string, unknown> = { auctionId: auction.id };
  const amountFilter: Record<string, number> = {};

  if (query.amount !== null && query.amount !== undefined) {
    // An exact lookup answers "was my amount taken?", so it ignores the scope.
    amountFilter.equals = query.amount;
  } else {
    if (query.cursor !== null && query.cursor !== undefined) amountFilter.gt = query.cursor;

    if (scope === 'proof') {
      // The decisive stretch: every amount up to and including the winner. If
      // each one below it was matched, the winner follows — that is the proof,
      // and the rest of the table is context.
      const winner = await prisma.auctionLedgerEntry.findFirst({
        where: { auctionId: auction.id, uniqueRank: 1 },
        select: { amount: true },
      });
      if (winner) amountFilter.lte = toNum(winner.amount);
    }

    if (scope === 'mine') {
      if (!viewerId) return { rows: [], nextCursor: null };
      // Bidder ids are random 25-character strings, so a substring match on the
      // stored JSON array picks out exactly the rows this bidder appears in.
      where.bidderIds = { contains: viewerId };
    }
  }

  if (Object.keys(amountFilter).length > 0) where.amount = amountFilter;

  const found = await prisma.auctionLedgerEntry.findMany({
    where: where as never,
    orderBy: { amount: 'asc' },
    take: limit + 1,
  });

  const page = found.slice(0, limit);
  const nextCursor =
    found.length > limit && page.length > 0 ? toNum(page[page.length - 1].amount) : null;

  const expandAmount = query.expandAmount ?? null;
  const parsed = page.map((row) => {
    const amount = toNum(row.amount);
    const bidderIds = parseBidderIds(row.bidderIds);
    // Amounts arrive as query strings, so they are compared inside half a cent
    // rather than by equality.
    const expanded = expandAmount !== null && Math.abs(expandAmount - amount) < 0.005;
    return { row, amount, bidderIds, expanded };
  });

  // Every bidder about to be rendered, resolved in one query rather than one
  // per row. Only the phone number is read: a ledger is not the place to put
  // somebody's name next to what they bid.
  const needed = new Set<string>();
  if (policy.showBidders) {
    for (const item of parsed) {
      const shown = item.expanded ? item.bidderIds : item.bidderIds.slice(0, BIDDER_PREVIEW);
      for (const id of shown) needed.add(id);
    }
  }

  const masked = new Map<string, string>();
  if (needed.size > 0) {
    const bidders = await prisma.bidder.findMany({
      where: { id: { in: Array.from(needed) } },
      select: { id: true, phoneNumber: true },
    });
    for (const bidder of bidders) masked.set(bidder.id, maskPhone(bidder.phoneNumber));
  }

  const rows: LedgerRow[] = parsed.map(({ row, amount, bidderIds, expanded }) => {
    const shown = policy.showBidders
      ? expanded
        ? bidderIds
        : bidderIds.slice(0, BIDDER_PREVIEW)
      : [];

    const mineIndexes: number[] = [];
    if (viewerId) {
      shown.forEach((id, index) => {
        if (id === viewerId) mineIndexes.push(index);
      });
    }

    return {
      amount,
      bidCount: row.bidCount,
      isUnique: row.isUnique,
      uniqueRank: row.uniqueRank,
      mine: viewerId ? bidderIds.includes(viewerId) : false,
      bidders: shown.map((id) => masked.get(id) ?? '—'),
      mineIndexes,
      truncated: policy.showBidders && shown.length < bidderIds.length,
    };
  });

  return { rows, nextCursor };
}

function parseBidderIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
