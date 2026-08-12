import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BIDDER_STATUSES } from '@/lib/types';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bidders' };

const PAGE_SIZE = 25;

export default async function BiddersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = BIDDER_STATUSES.includes(params.status as any) ? params.status : undefined;
  const q = params.q?.trim();

  const where: any = {
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ phoneNumber: { contains: q } }, { fullName: { contains: q } }] }
      : {}),
  };

  const [bidders, total, counts, totals] = await Promise.all([
    prisma.bidder.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bidder.count({ where }),
    prisma.bidder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.bidder.aggregate({ _sum: { totalSpent: true, totalBids: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));

  return (
    <>
      <PageHeader
        title="Bidders"
        description="Customer accounts, provisioned automatically from the super app."
      />

      <StatGrid>
        <StatCard label="Total bidders" value={total.toLocaleString()} />
        <StatCard label="Active" value={countByStatus.get('ACTIVE') ?? 0} tone="success" />
        <StatCard label="Suspended" value={countByStatus.get('SUSPENDED') ?? 0} tone="warning" />
        <StatCard label="Blocked" value={countByStatus.get('BLOCKED') ?? 0} tone="destructive" />
        <StatCard label="Bids placed" value={(totals._sum.totalBids ?? 0).toLocaleString()} />
        <StatCard
          label="Fees paid"
          value={`${toNum(totals._sum.totalSpent).toLocaleString('en-US', {
            maximumFractionDigits: 0,
          })} Br`}
        />
      </StatGrid>

      <div className="mt-4">
        <FilterBar>
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input id="q" name="q" defaultValue={q} placeholder="Phone number or name" />
          </div>
          <div className="min-w-[160px]">
            <Label htmlFor="status" className="text-xs">
              Status
            </Label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ''}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All statuses</option>
              {BIDDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </FilterBar>
      </div>

      <TableCard>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fees paid</th>
              <th className="px-4 py-2.5 text-right font-semibold">Wins</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Last seen</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bidders.length === 0 && <EmptyRow colSpan={8} message="No bidders match these filters." />}
            {bidders.map((bidder) => (
              <tr key={bidder.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 font-mono text-xs">
                  <Link
                    href={`/admin/bidders/${bidder.id}`}
                    className="font-semibold hover:text-primary"
                  >
                    {bidder.phoneNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{bidder.fullName || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{bidder.totalBids}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {toNum(bidder.totalSpent).toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {bidder.winsCount}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={bidder.status} />
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {bidder.lastSeenAt.toLocaleString('en-GB')}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/bidders/${bidder.id}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/bidders"
          params={{ q, status }}
        />
      </TableCard>
    </>
  );
}
