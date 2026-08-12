import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { EmptyRow, FilterBar, TableCard } from '@/components/admin/data-shell';
import { StatusBadge } from '@/components/admin/status-badge';
import { ActivityChart } from '@/components/admin/activity-chart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getDailyActivity } from '@/lib/dashboard-metrics';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(`${params.to}T23:59:59.999`) : new Date();

  const range = { gte: from, lte: to };

  const [
    user,
    activity,
    auctionsSettled,
    bidsConfirmed,
    feeRevenue,
    prizesAwarded,
    newBidders,
    auctionPerformance,
    categoryBreakdown,
  ] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    getDailyActivity(30),
    prisma.auction.count({ where: { status: 'SETTLED', settledAt: range } }),
    prisma.bid.count({ where: { status: 'ACTIVE', confirmedAt: range } }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS', updatedAt: range },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.winner.aggregate({ where: { createdAt: range }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.bidder.count({ where: { createdAt: range } }),
    prisma.auction.findMany({
      where: { status: 'SETTLED', settledAt: range },
      orderBy: { settledAt: 'desc' },
      take: 50,
      include: {
        item: { select: { retailPrice: true } },
        category: { select: { name: true } },
        winner: { select: { amount: true, status: true } },
      },
    }),
    prisma.auction.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
      _sum: { bidCount: true },
    }),
  ]);

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const canSeeMoney = hasPermission(user, 'payments', 'read');
  const revenue = toNum(feeRevenue._sum.amount);

  // Prize cost = what the platform hands out (retail value), revenue = fees.
  const prizeCost = auctionPerformance.reduce(
    (sum, auction) => sum + toNum(auction.item.retailPrice),
    0
  );
  const auctionRevenue = auctionPerformance.reduce(
    (sum, auction) => sum + toNum(auction.bidFee) * auction.bidCount,
    0
  );

  const toInput = (date: Date) => date.toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Performance from ${from.toLocaleDateString('en-GB')} to ${to.toLocaleDateString('en-GB')}.`}
        actions={
          hasPermission(user, 'audit-logs', 'read') && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/api/admin/audit-logs/export?from=${toInput(from)}&to=${toInput(to)}`}
                prefetch={false}
              >
                Export audit CSV
              </Link>
            </Button>
          )
        }
      />

      <FilterBar>
        <div>
          <Label htmlFor="from" className="text-xs">
            From
          </Label>
          <Input id="from" name="from" type="date" defaultValue={toInput(from)} />
        </div>
        <div>
          <Label htmlFor="to" className="text-xs">
            To
          </Label>
          <Input id="to" name="to" type="date" defaultValue={toInput(to)} />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </FilterBar>

      <StatGrid>
        <StatCard label="Auctions settled" value={auctionsSettled} />
        <StatCard label="Bids confirmed" value={bidsConfirmed.toLocaleString()} />
        <StatCard label="New bidders" value={newBidders.toLocaleString()} />
        <StatCard label="Prizes awarded" value={prizesAwarded._count._all} />
        {canSeeMoney && (
          <>
            <StatCard
              label="Fee revenue"
              value={`${revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })} Br`}
              hint={`${feeRevenue._count._all} payments`}
              tone="success"
            />
            <StatCard
              label="Prize retail cost"
              value={`${prizeCost.toLocaleString('en-US', { maximumFractionDigits: 0 })} Br`}
              hint="Settled auctions in range"
            />
            <StatCard
              label="Net (fees − prizes)"
              value={`${(auctionRevenue - prizeCost).toLocaleString('en-US', {
                maximumFractionDigits: 0,
              })} Br`}
              tone={auctionRevenue - prizeCost >= 0 ? 'success' : 'destructive'}
              hint="Settled auctions only"
            />
            <StatCard
              label="Winner payments"
              value={`${toNum(prizesAwarded._sum.amount).toFixed(2)} Br`}
              hint="Sum of winning bids"
            />
          </>
        )}
      </StatGrid>

      <div className="mt-6">
        <ActivityChart data={activity} showRevenue={canSeeMoney} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TableCard>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">Settled auction performance</h2>
              <p className="text-xs text-muted-foreground">
                Fee income versus the retail value handed out.
              </p>
            </div>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Auction</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Fee income</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Retail value</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Winning bid</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auctionPerformance.length === 0 && (
                  <EmptyRow colSpan={6} message="No auctions were settled in this range." />
                )}
                {auctionPerformance.map((auction) => {
                  const income = toNum(auction.bidFee) * auction.bidCount;
                  const cost = toNum(auction.item.retailPrice);
                  const margin = income - cost;

                  return (
                    <tr key={auction.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/auctions/${auction.id}`}
                          className="font-medium hover:text-primary"
                        >
                          #{auction.code}
                        </Link>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {auction.title} · {auction.category.name}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{auction.bidCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {income.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {cost.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {auction.winner ? (
                          toNum(auction.winner.amount).toFixed(2)
                        ) : (
                          <span className="text-xs text-muted-foreground">No winner</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                          margin >= 0 ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {margin.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        </div>

        <TableCard>
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">By category</h2>
            <p className="text-xs text-muted-foreground">All time</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50 text-left">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Auctions</th>
                <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categoryBreakdown.length === 0 && (
                <EmptyRow colSpan={3} message="No auctions yet." />
              )}
              {categoryBreakdown
                .sort((a, b) => (b._sum.bidCount ?? 0) - (a._sum.bidCount ?? 0))
                .map((row) => (
                  <tr key={row.categoryId}>
                    <td className="px-4 py-2.5">
                      {categoryNames.get(row.categoryId) ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row._count._all}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {(row._sum.bidCount ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableCard>
      </div>

      <TableCard className="mt-6">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Winner fulfilment status</h2>
        </div>
        <div className="p-4">
          <WinnerStatusSummary range={range} />
        </div>
      </TableCard>
    </>
  );
}

async function WinnerStatusSummary({ range }: { range: { gte: Date; lte: Date } }) {
  const groups = await prisma.winner.groupBy({
    by: ['status'],
    where: { createdAt: range },
    _count: { _all: true },
  });

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No winners in this range.</p>;
  }

  return (
    <ul className="flex flex-wrap gap-3">
      {groups.map((group) => (
        <li
          key={group.status}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
        >
          <StatusBadge status={group.status} />
          <span className="text-lg font-bold tabular-nums">{group._count._all}</span>
        </li>
      ))}
    </ul>
  );
}
