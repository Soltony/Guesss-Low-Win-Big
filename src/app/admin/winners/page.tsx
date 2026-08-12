import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { StatusBadge } from '@/components/admin/status-badge';
import { WinnerActions } from '@/components/admin/winner-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { WINNER_STATUSES } from '@/lib/types';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Winners' };

const PAGE_SIZE = 20;

export default async function WinnersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = WINNER_STATUSES.includes(params.status as any) ? params.status : undefined;
  const q = params.q?.trim();

  const where: any = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { bidder: { phoneNumber: { contains: q } } },
            { auction: { code: { contains: q } } },
            { auction: { title: { contains: q } } },
          ],
        }
      : {}),
  };

  const [user, winners, total, counts] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.winner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        bidder: { select: { id: true, phoneNumber: true, fullName: true } },
        auction: {
          select: {
            id: true,
            code: true,
            title: true,
            currency: true,
            item: { select: { retailPrice: true } },
          },
        },
      },
    }),
    prisma.winner.count({ where }),
    prisma.winner.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const canUpdate = hasPermission(user, 'winners', 'update');
  const canApprove = hasPermission(user, 'winners', 'approve');
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Winners"
        description="Prize claims, verification and delivery for every settled auction."
      />

      <StatGrid>
        <StatCard label="Total winners" value={total.toLocaleString()} />
        <StatCard
          label="Awaiting claim"
          value={countByStatus.get('PENDING_CLAIM') ?? 0}
          tone="warning"
        />
        <StatCard label="Claimed" value={countByStatus.get('CLAIMED') ?? 0} />
        <StatCard label="Delivered" value={countByStatus.get('FULFILLED') ?? 0} tone="success" />
        <StatCard
          label="Forfeited"
          value={countByStatus.get('FORFEITED') ?? 0}
          tone="destructive"
        />
      </StatGrid>

      <div className="mt-4">
        <FilterBar>
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input id="q" name="q" defaultValue={q} placeholder="Phone, auction code or title" />
          </div>
          <div className="min-w-[170px]">
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
              {WINNER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
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
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Auction</th>
              <th className="px-4 py-2.5 font-semibold">Winner</th>
              <th className="px-4 py-2.5 text-right font-semibold">Winning bid</th>
              <th className="px-4 py-2.5 text-right font-semibold">Retail value</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Claim window</th>
              <th className="px-4 py-2.5 font-semibold">Delivery</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {winners.length === 0 && (
              <EmptyRow colSpan={8} message="No winners match these filters." />
            )}
            {winners.map((winner) => {
              const overdue =
                winner.status === 'PENDING_CLAIM' &&
                winner.claimDeadline !== null &&
                winner.claimDeadline.getTime() < now;

              return (
                <tr key={winner.id} className="align-top hover:bg-secondary/30">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/auctions/${winner.auction.id}`}
                      className="font-medium hover:text-primary"
                    >
                      #{winner.auction.code}
                    </Link>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {winner.auction.title}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/bidders/${winner.bidder.id}`}
                      className="font-mono text-xs hover:text-primary"
                    >
                      {winner.bidder.phoneNumber}
                    </Link>
                    {winner.bidder.fullName && (
                      <p className="text-xs text-muted-foreground">{winner.bidder.fullName}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                    {toNum(winner.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {toNum(winner.auction.item.retailPrice).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={winner.status} />
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {winner.claimDeadline ? (
                      <span className={overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                        {overdue ? 'Expired ' : 'Until '}
                        {winner.claimDeadline.toLocaleString('en-GB')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {winner.deliveryName ? (
                      <>
                        <p className="font-medium">{winner.deliveryName}</p>
                        <p className="text-muted-foreground">{winner.deliveryPhone}</p>
                        <p className="line-clamp-2 text-muted-foreground">
                          {winner.deliveryAddress}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not submitted</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {canUpdate && (
                      <WinnerActions
                        winner={{
                          id: winner.id,
                          status: winner.status,
                          auctionCode: winner.auction.code,
                          phone: winner.bidder.phoneNumber,
                        }}
                        canPromote={canApprove}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/winners"
          params={{ status, q }}
        />
      </TableCard>
    </>
  );
}
