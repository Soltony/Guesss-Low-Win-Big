import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Gavel, Trophy, Wallet } from 'lucide-react';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { StatusBadge } from '@/components/admin/status-badge';
import { TableCard } from '@/components/admin/data-shell';
import { BidderModeration } from '@/components/admin/bidder-moderation';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { ADMIN_VIEWER, formatRevealedAmount, revealBidAmount } from '@/lib/bid-visibility';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bidder = await prisma.bidder.findUnique({
    where: { id },
    select: { phoneNumber: true },
  });
  return { title: bidder?.phoneNumber ?? 'Bidder' };
}

export default async function BidderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bidder, user] = await Promise.all([
    prisma.bidder.findUnique({
      where: { id },
      include: { moderatedBy: { select: { fullName: true } } },
    }),
    getCurrentUser({ allowRefresh: false }),
  ]);

  if (!bidder) notFound();

  const [bids, wins, payments] = await Promise.all([
    prisma.bid.findMany({
      where: { bidderId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      // `status` decides whether each amount may be shown: this page is an
      // operator view, so a bid is only legible once its auction has settled.
      include: { auction: { select: { id: true, code: true, title: true, status: true } } },
    }),
    prisma.winner.findMany({
      where: { bidderId: id },
      orderBy: { createdAt: 'desc' },
      include: { auction: { select: { id: true, code: true, title: true } } },
    }),
    hasPermission(user, 'payments', 'read')
      ? prisma.paymentTransaction.findMany({
          where: { bidderId: id },
          orderBy: { createdAt: 'desc' },
          take: 15,
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={bidder.fullName || bidder.phoneNumber}
        breadcrumbs={[{ label: 'Bidders', href: '/admin/bidders' }, { label: bidder.phoneNumber }]}
        description={`Joined ${bidder.createdAt.toLocaleDateString('en-GB')} · last seen ${bidder.lastSeenAt.toLocaleString('en-GB')}`}
        actions={<StatusBadge status={bidder.status} />}
      />

      <StatGrid>
        <StatCard label="Confirmed bids" value={bidder.totalBids} icon={Gavel} tone="primary" />
        <StatCard
          label="Fees paid"
          value={`${toNum(bidder.totalSpent).toFixed(2)} Br`}
          icon={Wallet}
        />
        <StatCard label="Wins" value={bidder.winsCount} icon={Trophy} tone="success" />
        <StatCard label="Language" value={bidder.language === 'am' ? 'አማርኛ' : 'English'} />
      </StatGrid>

      {bidder.statusReason && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">Moderation note</p>
          <p className="mt-1 text-muted-foreground">
            {bidder.statusReason}
            {bidder.moderatedBy && ` — ${bidder.moderatedBy.fullName}`}
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <TableCard>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">Recent bids</h2>
              <p className="text-xs text-muted-foreground">
                Amounts are revealed once their auction settles.
              </p>
            </div>
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Auction</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bids.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No bids yet.
                    </td>
                  </tr>
                )}
                {bids.map((bid) => (
                  <tr key={bid.id}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/auctions/${bid.auction.id}`}
                        className="font-medium hover:text-primary"
                      >
                        #{bid.auction.code}
                      </Link>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {bid.auction.title}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatRevealedAmount(revealBidAmount(bid, bid.auction, ADMIN_VIEWER))}
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

          {payments.length > 0 && (
            <TableCard>
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Recent payments</h2>
              </div>
              <table className="w-full min-w-[600px] text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Transaction</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {payment.txnRef || payment.transactionId.slice(0, 12)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {toNum(payment.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {payment.createdAt.toLocaleString('en-GB')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        </div>

        <div className="space-y-4">
          {hasPermission(user, 'bidders', 'update') && (
            <BidderModeration
              bidderId={bidder.id}
              phone={bidder.phoneNumber}
              status={bidder.status}
            />
          )}

          <TableCard>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">Wins ({wins.length})</h2>
            </div>
            <ul className="divide-y divide-border">
              {wins.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No wins yet.
                </li>
              )}
              {wins.map((win) => (
                <li key={win.id} className="px-4 py-3">
                  <Link
                    href={`/admin/auctions/${win.auction.id}`}
                    className="text-sm font-medium hover:text-primary"
                  >
                    #{win.auction.code} {win.auction.title}
                  </Link>
                  <div className="mt-1 flex items-center justify-between">
                    <StatusBadge status={win.status} />
                    <span className="text-sm font-bold tabular-nums">
                      {toNum(win.amount).toFixed(2)} Br
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </TableCard>
        </div>
      </div>
    </>
  );
}
