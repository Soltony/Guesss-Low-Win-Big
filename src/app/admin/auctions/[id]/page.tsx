import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, Gavel, ListOrdered, Trophy, Users, Wallet } from 'lucide-react';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { StatusBadge } from '@/components/admin/status-badge';
import { TableCard } from '@/components/admin/data-shell';
import { AuctionActions } from '@/components/admin/auction-actions';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { syncAuctionLifecycle, rankUniqueBids } from '@/lib/auction-engine';
import { maskPhone, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { title: true, code: true },
  });
  return { title: auction ? `#${auction.code} ${auction.title}` : 'Auction' };
}

export default async function AdminAuctionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await syncAuctionLifecycle();
  const { id } = await params;

  const [auction, user] = await Promise.all([
    prisma.auction.findUnique({
      where: { id },
      include: {
        item: true,
        category: true,
        createdBy: { select: { fullName: true } },
        settledBy: { select: { fullName: true } },
        winner: { include: { bidder: true } },
        results: {
          orderBy: { rank: 'asc' },
          include: { bidder: { select: { phoneNumber: true, fullName: true } } },
        },
      },
    }),
    getCurrentUser({ allowRefresh: false }),
  ]);

  if (!auction) notFound();

  const canUpdate = hasPermission(user, 'auctions', 'update');
  const canSettle = hasPermission(user, 'auctions', 'approve');
  const canSeeBids = hasPermission(user, 'bids', 'read');

  const [paidFees, recentBids, distribution] = await Promise.all([
    prisma.bid.aggregate({
      where: { auctionId: id, status: 'ACTIVE' },
      _sum: { feeAmount: true },
    }),
    canSeeBids
      ? prisma.bid.findMany({
          where: { auctionId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { bidder: { select: { phoneNumber: true, fullName: true } } },
        })
      : Promise.resolve([]),
    // Uniqueness preview for operators: how the result would land right now.
    canSettle && auction.status !== 'SETTLED'
      ? prisma.bid.findMany({
          where: { auctionId: id, status: 'ACTIVE' },
          select: { id: true, bidderId: true, amount: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const preview =
    distribution.length > 0
      ? rankUniqueBids(
          distribution.map((b) => ({
            id: b.id,
            bidderId: b.bidderId,
            amount: toNum(b.amount),
            createdAt: b.createdAt,
          }))
        ).slice(0, 5)
      : [];

  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;

  return (
    <>
      <PageHeader
        title={auction.title}
        breadcrumbs={[
          { label: 'Auctions', href: '/admin/auctions' },
          { label: `#${auction.code}` },
        ]}
        description={`${auction.category.name} · ${auction.item.name}`}
        actions={
          <>
            <StatusBadge status={auction.status} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/auctions/${auction.code}`} target="_blank">
                <Eye className="mr-1.5 h-4 w-4" />
                View in app
              </Link>
            </Button>
            {canUpdate && auction.status !== 'SETTLED' && auction.status !== 'CANCELLED' && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/auctions/${auction.id}/edit`}>Edit</Link>
              </Button>
            )}
          </>
        }
      />

      <StatGrid>
        <StatCard label="Confirmed bids" value={auction.bidCount} icon={ListOrdered} tone="primary" />
        <StatCard label="Unique bidders" value={auction.bidderCount} icon={Users} />
        <StatCard label="Views" value={auction.viewCount} icon={Eye} />
        <StatCard
          label="Fees collected"
          value={`${toNum(paidFees._sum.feeAmount).toFixed(2)} ${currency}`}
          icon={Wallet}
          tone="success"
        />
        <StatCard
          label="Retail value"
          value={`${toNum(auction.item.retailPrice).toFixed(2)} ${currency}`}
          icon={Trophy}
        />
        <StatCard
          label="Bid range"
          value={`${toNum(auction.minBidAmount).toFixed(2)} – ${toNum(auction.maxBidAmount).toFixed(2)}`}
          hint={`step ${toNum(auction.bidStep).toFixed(2)} · max ${auction.maxBidsPerUser}/bidder`}
          icon={Gavel}
        />
      </StatGrid>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Result */}
          {auction.status === 'SETTLED' && (
            <TableCard>
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Result</h2>
                <p className="text-xs text-muted-foreground">
                  Settled{' '}
                  {auction.settledAt?.toLocaleString('en-GB') ?? ''}
                  {auction.settledBy ? ` by ${auction.settledBy.fullName}` : ' automatically'}
                </p>
              </div>

              {auction.results.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No unique bid was placed — this auction has no winner.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/50 text-left">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Rank</th>
                      <th className="px-4 py-2.5 font-semibold">Bidder</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2.5 font-semibold">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auction.results.map((result) => (
                      <tr key={result.id} className={result.rank === 1 ? 'bg-primary/5' : ''}>
                        <td className="px-4 py-2.5 font-bold tabular-nums">#{result.rank}</td>
                        <td className="px-4 py-2.5">
                          {result.bidder.fullName || maskPhone(result.bidder.phoneNumber)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {maskPhone(result.bidder.phoneNumber)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                          {toNum(result.amount).toFixed(2)} {currency}
                        </td>
                        <td className="px-4 py-2.5">
                          {result.rank === 1 ? (
                            <StatusBadge status={auction.winner?.status ?? 'PENDING_CLAIM'} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Runner-up</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableCard>
          )}

          {/* Provisional result */}
          {preview.length > 0 && (
            <TableCard>
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Provisional result</h2>
                <p className="text-xs text-muted-foreground">
                  How this auction would settle right now. Never shown to bidders.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Rank</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((entry) => (
                    <tr key={entry.bidId}>
                      <td className="px-4 py-2.5 font-bold tabular-nums">#{entry.rank}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                        {entry.amount.toFixed(2)} {currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}

          {/* Recent bids */}
          {canSeeBids && (
            <TableCard>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-semibold">Latest bids</h2>
                <Link
                  href={`/admin/bids?auctionId=${auction.id}`}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  View all →
                </Link>
              </div>
              <table className="w-full min-w-[600px] text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Bidder</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Placed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentBids.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No bids yet.
                      </td>
                    </tr>
                  )}
                  {recentBids.map((bid) => (
                    <tr key={bid.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/bidders/${bid.bidderId}`}
                          className="hover:text-primary"
                        >
                          {maskPhone(bid.bidder.phoneNumber)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {toNum(bid.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={bid.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {bid.createdAt.toLocaleString('en-GB')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        </div>

        <div className="space-y-4">
          <AuctionActions
            auction={{
              id: auction.id,
              code: auction.code,
              status: auction.status,
              featured: auction.featured,
              bidCount: auction.bidCount,
            }}
            canUpdate={canUpdate}
            canSettle={canSettle}
          />

          <TableCard>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">Details</h2>
            </div>
            <dl className="divide-y divide-border text-sm">
              {[
                ['Auction code', auction.code],
                ['Item', auction.item.name],
                ['Category', auction.category.name],
                ['Bid fee', `${toNum(auction.bidFee).toFixed(2)} ${currency}`],
                ['Max bids / bidder', String(auction.maxBidsPerUser)],
                ['Auto-extend', auction.autoExtendMinutes ? `${auction.autoExtendMinutes} min` : 'Off'],
                ['Times extended', String(auction.extendedCount)],
                ['Starts', auction.startAt.toLocaleString('en-GB')],
                ['Ends', auction.endAt.toLocaleString('en-GB')],
                ['Created by', auction.createdBy?.fullName ?? '—'],
                ['Published', auction.publishedAt?.toLocaleString('en-GB') ?? 'Not published'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </TableCard>

          {auction.cancelledReason && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p className="font-semibold text-destructive">Cancelled</p>
              <p className="mt-1 text-muted-foreground">{auction.cancelledReason}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
