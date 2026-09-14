import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BIDDER_BID_SEGMENTS, BIDDER_STATUSES } from '@/lib/types';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bidders' };

const PAGE_SIZE = 25;

/** Inclusive `totalBids` range for a bid-count segment, as a Prisma filter. */
function bidCountFilter(min: number, max: number | null) {
  return { totalBids: { gte: min, ...(max === null ? {} : { lte: max }) } };
}

export default async function BiddersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; bids?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = BIDDER_STATUSES.includes(params.status as any) ? params.status : undefined;
  const q = params.q?.trim();
  const segment = BIDDER_BID_SEGMENTS.find((s) => s.value === params.bids);

  // Search and status scope the engagement cards; the bid-count filter does
  // not, so the segment counts stay comparable while browsing one of them.
  const baseWhere: any = {
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ phoneNumber: { contains: q } }, { fullName: { contains: q } }] }
      : {}),
  };
  const where: any = {
    ...baseWhere,
    ...(segment ? bidCountFilter(segment.min, segment.max) : {}),
  };

  const [bidders, total, counts, totals, neverBid, bidOnce, bidRepeat] = await Promise.all([
    prisma.bidder.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bidder.count({ where }),
    prisma.bidder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.bidder.aggregate({ _sum: { totalSpent: true, totalBids: true } }),
    prisma.bidder.count({ where: { ...baseWhere, ...bidCountFilter(0, 0) } }),
    prisma.bidder.count({ where: { ...baseWhere, ...bidCountFilter(1, 1) } }),
    prisma.bidder.count({ where: { ...baseWhere, ...bidCountFilter(2, null) } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  // The three buckets partition the scoped population, so they sum to it.
  const scopedTotal = neverBid + bidOnce + bidRepeat;
  const share = (n: number) =>
    scopedTotal === 0 ? '—' : `${Math.round((n / scopedTotal) * 100)}% of bidders`;

  /** Filter link that keeps search and status, and resets paging. */
  const segmentHref = (value?: string) => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (status) search.set('status', status);
    if (value) search.set('bids', value);
    const query = search.toString();
    return query ? `/admin/bidders?${query}` : '/admin/bidders';
  };
  // Clicking the card that is already applied clears the filter.
  const toggleHref = (value: string) =>
    segmentHref(segment?.value === value ? undefined : value);

  return (
    <>
      <PageHeader
        title="Bidders"
        description="Customer accounts, provisioned automatically from the super app."
      />

      <StatGrid>
        <StatCard label="Total bidders" value={scopedTotal.toLocaleString()} />
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
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Engagement — click a card to filter
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Never bid"
            value={neverBid.toLocaleString()}
            hint={share(neverBid)}
            href={toggleHref('none')}
            active={segment?.value === 'none'}
          />
          <StatCard
            label="Bid once"
            value={bidOnce.toLocaleString()}
            hint={share(bidOnce)}
            tone="warning"
            href={toggleHref('once')}
            active={segment?.value === 'once'}
          />
          <StatCard
            label="Bid more than once"
            value={bidRepeat.toLocaleString()}
            hint={share(bidRepeat)}
            tone="success"
            href={toggleHref('repeat')}
            active={segment?.value === 'repeat'}
          />
        </div>
      </div>

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
          <div className="min-w-[180px]">
            <Label htmlFor="bids" className="text-xs">
              Bids placed
            </Label>
            <select
              id="bids"
              name="bids"
              defaultValue={segment?.value ?? ''}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Any number of bids</option>
              {BIDDER_BID_SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
          params={{ q, status, bids: segment?.value }}
        />
      </TableCard>
    </>
  );
}
