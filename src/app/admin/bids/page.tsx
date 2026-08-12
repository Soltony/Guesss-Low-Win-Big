import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BID_STATUSES } from '@/lib/types';
import { maskPhone, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bids' };

const PAGE_SIZE = 50;

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{
    auctionId?: string;
    status?: string;
    phone?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = BID_STATUSES.includes(params.status as any) ? params.status : undefined;
  const phone = params.phone?.trim();

  const where: any = {
    ...(params.auctionId ? { auctionId: params.auctionId } : {}),
    ...(status ? { status } : {}),
    ...(phone ? { bidder: { phoneNumber: { contains: phone } } } : {}),
  };

  const [bids, total, auction, aggregates] = await Promise.all([
    prisma.bid.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        bidder: { select: { id: true, phoneNumber: true, fullName: true } },
        auction: { select: { id: true, code: true, title: true, currency: true } },
      },
    }),
    prisma.bid.count({ where }),
    params.auctionId
      ? prisma.auction.findUnique({
          where: { id: params.auctionId },
          select: { id: true, code: true, title: true, status: true, bidCount: true },
        })
      : Promise.resolve(null),
    prisma.bid.aggregate({ where, _sum: { feeAmount: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Bids"
        description={
          auction
            ? `Bids on #${auction.code} — ${auction.title}`
            : 'Every bid across all auctions, including unpaid attempts.'
        }
        breadcrumbs={
          auction
            ? [
                { label: 'Auctions', href: '/admin/auctions' },
                { label: `#${auction.code}`, href: `/admin/auctions/${auction.id}` },
                { label: 'Bids' },
              ]
            : undefined
        }
      />

      <StatGrid>
        <StatCard label="Matching bids" value={total.toLocaleString()} />
        <StatCard
          label="Fees in scope"
          value={`${toNum(aggregates._sum.feeAmount).toFixed(2)} Br`}
          hint="Includes unpaid attempts"
        />
        {auction && <StatCard label="Confirmed on auction" value={auction.bidCount} />}
      </StatGrid>

      <div className="mt-4">
        <FilterBar>
          {params.auctionId && <input type="hidden" name="auctionId" value={params.auctionId} />}
          <div className="min-w-[180px]">
            <Label htmlFor="phone" className="text-xs">
              Bidder phone
            </Label>
            <Input id="phone" name="phone" defaultValue={phone} placeholder="2519…" />
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
              {BID_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {(status || phone || params.auctionId) && (
            <Button asChild variant="ghost">
              <Link href="/admin/bids">Reset</Link>
            </Button>
          )}
        </FilterBar>
      </div>

      <TableCard>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Placed</th>
              <th className="px-4 py-2.5 font-semibold">Auction</th>
              <th className="px-4 py-2.5 font-semibold">Bidder</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fee</th>
              <th className="px-4 py-2.5 text-right font-semibold">#</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bids.length === 0 && <EmptyRow colSpan={8} message="No bids match these filters." />}
            {bids.map((bid) => (
              <tr key={bid.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {bid.createdAt.toLocaleString('en-GB')}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/auctions/${bid.auction.id}`}
                    className="font-medium hover:text-primary"
                  >
                    #{bid.auction.code}
                  </Link>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{bid.auction.title}</p>
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/bidders/${bid.bidder.id}`}
                    className="hover:text-primary"
                  >
                    {maskPhone(bid.bidder.phoneNumber)}
                  </Link>
                  {bid.bidder.fullName && (
                    <p className="text-xs text-muted-foreground">{bid.bidder.fullName}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                  {toNum(bid.amount).toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {toNum(bid.feeAmount).toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {bid.sequence}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={bid.status} />
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {bid.isUnique === null ? (
                    <span className="text-muted-foreground">Not settled</span>
                  ) : bid.isUnique ? (
                    <span className="font-semibold text-primary">
                      Unique{bid.rankAtSettlement ? ` · #${bid.rankAtSettlement}` : ''}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Duplicated</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/bids"
          params={{ auctionId: params.auctionId, status, phone }}
        />
      </TableCard>
    </>
  );
}
