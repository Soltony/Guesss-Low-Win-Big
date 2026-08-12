import Link from 'next/link';
import { Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { syncAuctionLifecycle } from '@/lib/auction-engine';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { toNum } from '@/lib/format';
import { AUCTION_STATUSES } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Auctions' };

const PAGE_SIZE = 20;

export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await syncAuctionLifecycle();
  const params = await searchParams;
  const user = await getCurrentUser({ allowRefresh: false });

  const page = Math.max(1, Number(params.page) || 1);
  const status = AUCTION_STATUSES.includes(params.status as any) ? params.status : undefined;
  const q = params.q?.trim();

  const where: any = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { code: { contains: q } }] } : {}),
  };

  const [auctions, total, counts] = await Promise.all([
    prisma.auction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true } },
        item: { select: { name: true } },
      },
    }),
    prisma.auction.count({ where }),
    prisma.auction.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const canCreate = hasPermission(user, 'auctions', 'create');

  return (
    <>
      <PageHeader
        title="Auctions"
        description="Create, publish and settle lowest-unique-bid auctions."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/admin/auctions/new">
                <Plus className="mr-1.5 h-4 w-4" />
                New auction
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/auctions"
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            !status ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'
          }`}
        >
          All ({total === 0 && !status ? 0 : Array.from(countByStatus.values()).reduce((a, b) => a + b, 0)})
        </Link>
        {AUCTION_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/admin/auctions?status=${value}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              status === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card'
            }`}
          >
            {value.replace(/_/g, ' ')} ({countByStatus.get(value) ?? 0})
          </Link>
        ))}
      </div>

      <FilterBar>
        {status && <input type="hidden" name="status" value={status} />}
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="q" className="text-xs">
            Search
          </Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Title or auction code" />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </FilterBar>

      <TableCard>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Code</th>
              <th className="px-4 py-2.5 font-semibold">Auction</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fee</th>
              <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
              <th className="px-4 py-2.5 text-right font-semibold">Bidders</th>
              <th className="px-4 py-2.5 font-semibold">Window</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {auctions.length === 0 && (
              <EmptyRow colSpan={8} message="No auctions match these filters." />
            )}
            {auctions.map((auction) => (
              <tr key={auction.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 font-mono text-xs font-semibold">{auction.code}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/auctions/${auction.id}`}
                    className="font-medium hover:text-primary"
                  >
                    {auction.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {auction.category.name} · {auction.item.name}
                    {auction.featured && ' · ★ featured'}
                  </p>
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={auction.status} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {toNum(auction.bidFee).toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {auction.bidCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{auction.bidderCount}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {auction.startAt.toLocaleDateString('en-GB')} →{' '}
                  {auction.endAt.toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/auctions/${auction.id}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Manage
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
          basePath="/admin/auctions"
          params={{ status, q }}
        />
      </TableCard>
    </>
  );
}
