import prisma from './prisma';
import { toNum } from './format';
import { getTaxConfig, type TaxConfig } from './tax';

/**
 * What the platform has collected on the revenue authority's behalf, and
 * therefore owes it.
 *
 * Summed over payment transactions rather than over bids, because a bid is a
 * record of intent and a transaction is a record of money: a bid whose payment
 * failed, expired or was never approved carries the same `feeTax` as one that
 * was paid, and remitting on those would hand over tax that was never
 * collected. Only SUCCESS rows count, and REVERSED rows are subtracted — a
 * refunded fee takes its tax back out with it.
 */

export interface TaxPeriod {
  /** yyyy-MM, the granularity most remittance filings are made at. */
  month: string;
  gross: number;
  net: number;
  tax: number;
  transactions: number;
}

export interface TaxReport {
  config: TaxConfig;
  /** Fees successfully collected in the range. */
  gross: number;
  /** The platform's share. */
  net: number;
  /** The revenue authority's share — what is owed, before reversals. */
  tax: number;
  transactions: number;
  /** Fees handed back in the range, and the tax that goes back with them. */
  reversed: { gross: number; tax: number; transactions: number };
  /** `tax` less the tax on reversals. This is the figure to remit. */
  payable: number;
  /**
   * Collected before tax was switched on, or at a zero rate: charged in the
   * range but carrying no tax. Called out so a total that looks short of the
   * headline rate is explained rather than merely wrong-looking.
   */
  untaxed: { gross: number; transactions: number };
  byMonth: TaxPeriod[];
}

export async function getTaxReport(range: { gte: Date; lte: Date }): Promise<TaxReport> {
  const config = await getTaxConfig();

  // `updatedAt` rather than `createdAt`: a transaction is stamped when the
  // gateway callback resolves it, which is when the money actually moved, and
  // that is the date a filing period is drawn around. It is the same field the
  // fee-revenue figures on this page are already summed over, so the two
  // reconcile against each other.
  const [collected, reversed, untaxed, rows] = await Promise.all([
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', updatedAt: range },
      _sum: { amount: true, taxAmount: true },
      _count: { _all: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'REVERSED', updatedAt: range },
      _sum: { amount: true, taxAmount: true },
      _count: { _all: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', updatedAt: range, taxAmount: { lte: 0 } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.paymentTransaction.findMany({
      where: { status: 'SUCCESS', updatedAt: range, taxAmount: { gt: 0 } },
      select: { updatedAt: true, amount: true, taxAmount: true },
    }),
  ]);

  // Bucketed in memory rather than by a SQL date expression: the row set is one
  // reporting range of successful charges, and grouping it here keeps the query
  // portable and the month boundary on one definition instead of two.
  const buckets = new Map<string, TaxPeriod>();
  for (const row of rows) {
    const month = row.updatedAt.toISOString().slice(0, 7);
    const bucket = buckets.get(month) ?? { month, gross: 0, net: 0, tax: 0, transactions: 0 };
    bucket.gross += toNum(row.amount);
    bucket.net += toNum(row.amount) - toNum(row.taxAmount);
    bucket.tax += toNum(row.taxAmount);
    bucket.transactions += 1;
    buckets.set(month, bucket);
  }

  const tax = toNum(collected._sum.taxAmount);
  const reversedTax = toNum(reversed._sum.taxAmount);
  const gross = toNum(collected._sum.amount);

  return {
    config,
    gross,
    // Derived, not summed off `netAmount`. That column defaults to 0, so every
    // transaction written before this feature existed stores a real gross
    // against a zero net, and summing it would report the platform as having
    // earned nothing at all before tax was switched on. The split guarantees
    // net + tax === gross, so subtracting is both correct and backfill-free.
    net: Math.round((gross - tax) * 100) / 100,
    tax,
    transactions: collected._count._all,
    reversed: {
      gross: toNum(reversed._sum.amount),
      tax: reversedTax,
      transactions: reversed._count._all,
    },
    // Can legitimately go negative: a reversal in this period of a fee
    // collected in the last one is a credit against this period's filing.
    payable: Math.round((tax - reversedTax) * 100) / 100,
    untaxed: {
      gross: toNum(untaxed._sum.amount),
      transactions: untaxed._count._all,
    },
    byMonth: Array.from(buckets.values()).sort((a, b) => b.month.localeCompare(a.month)),
  };
}

/** Tax charged per auction, for the settled-performance table. */
export async function taxByAuction(auctionIds: string[]): Promise<Map<string, number>> {
  if (auctionIds.length === 0) return new Map();
  // Read off the bids here, not the transactions: this column sits beside the
  // fee-income column, which is itself summed over ACTIVE bids, and the two
  // must be the same population or the tax will not look like the rate applied
  // to the income printed next to it.
  const rows = await prisma.bid.groupBy({
    by: ['auctionId'],
    where: { auctionId: { in: auctionIds }, status: 'ACTIVE' },
    _sum: { feeTax: true },
  });
  return new Map(rows.map((row) => [row.auctionId, toNum(row._sum.feeTax)]));
}
