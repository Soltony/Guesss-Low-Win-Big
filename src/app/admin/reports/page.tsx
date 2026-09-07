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
import { getTaxReport, taxByAuction } from '@/lib/tax-report';

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
    taxReport,
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
    getTaxReport(range),
  ]);

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  // Fee income per auction, taken from what each bid was actually charged
  // rather than from the auction's fee times its bid count. Not every confirmed
  // bid raised a fee: a bid carried into a re-auction round was paid for in an
  // earlier round and is charged nothing, and a bid placed from a test session
  // is charged nothing at all. Multiplying the headline fee by the bid count
  // counted both as income the platform never collected.
  const settledIds = auctionPerformance.map((auction) => auction.id);
  const feeRows = settledIds.length
    ? await prisma.bid.groupBy({
        by: ['auctionId'],
        where: { auctionId: { in: settledIds }, status: 'ACTIVE' },
        _sum: { feeAmount: true },
      })
    : [];
  const feesByAuction = new Map(
    feeRows.map((row) => [row.auctionId, toNum(row._sum.feeAmount)])
  );
  // Bids that actually carried a fee, so the income figure can be read against
  // the bid count it came from instead of looking short of it.
  const chargedRows = settledIds.length
    ? await prisma.bid.groupBy({
        by: ['auctionId'],
        where: { auctionId: { in: settledIds }, status: 'ACTIVE', feeAmount: { gt: 0 } },
        _count: { _all: true },
      })
    : [];
  const chargedByAuction = new Map(
    chargedRows.map((row) => [row.auctionId, row._count._all])
  );
  const taxPerAuction = await taxByAuction(settledIds);

  // The tax figures earn their space only once tax has actually been charged.
  // Left visible while it is switched off they would be a permanent row of
  // zeros on a page whose whole job is figures that mean something. The second
  // clause keeps history readable after tax is switched back off.
  const showTax = taxReport.config.enabled || taxReport.tax > 0;

  const canSeeMoney = hasPermission(user, 'payments', 'read');
  const revenue = toNum(feeRevenue._sum.amount);

  // Prize cost = what the platform hands out (retail value), revenue = fees.
  const prizeCost = auctionPerformance.reduce(
    (sum, auction) => sum + toNum(auction.item.retailPrice),
    0
  );
  const auctionRevenue = auctionPerformance.reduce(
    (sum, auction) => sum + (feesByAuction.get(auction.id) ?? 0),
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
            {showTax && (
              <StatCard
                label={`${taxReport.config.label} collected`}
                value={`${taxReport.tax.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} Br`}
                hint={`Already inside fee revenue · ${taxReport.config.rate}% inclusive`}
              />
            )}
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
                {canSeeMoney
                  ? 'Fee income actually charged, versus the retail value handed out.'
                  : 'Settlement volume. Monetary figures need the payments permission.'}
              </p>
            </div>
            <table className={`w-full text-sm ${canSeeMoney ? 'min-w-[820px]' : 'min-w-[420px]'}`}>
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Auction</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
                  {/* Every column below this point is money. A role holding
                      reports:read alone must not be able to read fee income,
                      prize value or a winning bid off this table — the stat
                      tiles above already withhold the same figures. */}
                  {canSeeMoney && (
                    <>
                      <th className="px-4 py-2.5 text-right font-semibold">Fee income</th>
                      {showTax && (
                        <th className="px-4 py-2.5 text-right font-semibold">
                          {taxReport.config.label}
                        </th>
                      )}
                      <th className="px-4 py-2.5 text-right font-semibold">Retail value</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Winning bid</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auctionPerformance.length === 0 && (
                  <EmptyRow
                    colSpan={canSeeMoney ? (showTax ? 7 : 6) : 2}
                    message="No auctions were settled in this range."
                  />
                )}
                {auctionPerformance.map((auction) => {
                  const income = feesByAuction.get(auction.id) ?? 0;
                  const charged = chargedByAuction.get(auction.id) ?? 0;
                  const cost = toNum(auction.item.retailPrice);
                  // Margin is struck against fee income gross of tax, as it
                  // always has been. The tax column beside it says how much of
                  // that income is not the platform's to keep.
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
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {auction.bidCount}
                        {charged !== auction.bidCount && (
                          <p className="text-xs font-normal text-muted-foreground">
                            {charged} charged
                          </p>
                        )}
                      </td>
                      {canSeeMoney && (
                        <>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {income.toFixed(2)}
                          </td>
                          {showTax && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {(taxPerAuction.get(auction.id) ?? 0).toFixed(2)}
                            </td>
                          )}
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
                        </>
                      )}
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

      {canSeeMoney && showTax && <TaxSection report={taxReport} />}

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

/**
 * What is owed to the revenue authority for the range, and where it goes.
 *
 * Fees are charged once, in full, to the collection account — the super-app
 * gateway credits one account per charge — so the tax share is not routed away
 * at payment time. This panel is the instruction for moving it: the amount, the
 * destination account, and the periods it accrued over.
 */
function TaxSection({ report }: { report: Awaited<ReturnType<typeof getTaxReport>> }) {
  const { config } = report;
  const money = (n: number) =>
    `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Br`;

  return (
    <TableCard className="mt-6">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{config.label} collected</h2>
        <p className="text-xs text-muted-foreground">
          {config.rate}% inclusive of the bid service fee — the fee charged to bidders already
          contains it. Summed over settled payments, so an unpaid or expired bid is never
          remitted on.
        </p>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <TaxFigure
          label="Fees collected (gross)"
          value={money(report.gross)}
          hint={`${report.transactions} payments`}
        />
        <TaxFigure
          label="Platform net"
          value={money(report.net)}
          hint={`Excludes ${config.label}`}
        />
        <TaxFigure label={`${config.label} collected`} value={money(report.tax)} />
        <TaxFigure
          label={`${config.label} payable`}
          value={money(report.payable)}
          hint={
            report.reversed.transactions > 0
              ? `After ${money(report.reversed.tax)} on ${report.reversed.transactions} reversal(s)`
              : 'Nothing reversed in range'
          }
          strong
        />
      </div>

      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {config.accountNo ? (
          <p>
            Remit to account{' '}
            <span className="font-semibold tabular-nums text-foreground">{config.accountNo}</span>
            {config.registrationNumber ? <> · registration {config.registrationNumber}</> : null}
          </p>
        ) : (
          <p className="text-destructive">
            No tax collection account is configured. Set one under Settings → Tax so this figure
            has a destination.
          </p>
        )}
        {report.untaxed.transactions > 0 && (
          <p className="mt-1">
            {money(report.untaxed.gross)} across {report.untaxed.transactions} payment(s) carried
            no {config.label} — charged before tax was switched on, or at a zero rate.
          </p>
        )}
      </div>

      {report.byMonth.length > 0 && (
        <table className="w-full text-sm">
          <thead className="border-y border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Period</th>
              <th className="px-4 py-2.5 text-right font-semibold">Payments</th>
              <th className="px-4 py-2.5 text-right font-semibold">Gross</th>
              <th className="px-4 py-2.5 text-right font-semibold">Net</th>
              <th className="px-4 py-2.5 text-right font-semibold">{config.label}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.byMonth.map((period) => (
              <tr key={period.month} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 font-medium">{period.month}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{period.transactions}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{period.gross.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {period.net.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {period.tax.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function TaxFigure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${strong ? 'text-success' : ''}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
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
