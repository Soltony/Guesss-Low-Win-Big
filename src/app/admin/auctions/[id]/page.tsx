import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, Gavel, ListOrdered, Trophy, UserCheck, Users, Wallet } from 'lucide-react';
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
import { lineageRounds } from '@/lib/reauction';
import { isRestricted, participantCount, unlistedBidderCount } from '@/lib/eligibility';
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

  const [paidFees, recentBids, distribution, rounds, credits, participantTotal, unlisted] =
    await Promise.all([
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
      lineageRounds(auction),
      prisma.bidCredit.findMany({
        where: { auctionId: id },
        orderBy: { granted: 'desc' },
        take: 25,
        include: { bidder: { select: { phoneNumber: true, fullName: true } } },
      }),
      participantCount(id),
      unlistedBidderCount(auction),
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

  const carriedGranted = credits.reduce((sum, credit) => sum + credit.granted, 0);
  const carriedRemaining = credits.reduce((sum, credit) => sum + credit.remaining, 0);
  const carriedValue = credits.reduce(
    (sum, credit) => sum + credit.granted * toNum(credit.unitFee),
    0
  );
  // Anything past the original round, or a chain that has been decided one way
  // or another, is worth showing; a plain draft auction is not.
  const showLineage = rounds.length > 1 || auction.reauctionEnabled;

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

              {/* A round can rank bids and still award nothing — that is what a
                  participation floor does. Say so rather than showing rank 1
                  with a claim status it never got. */}
              {auction.results.length > 0 && !auction.winner && (
                <p className="border-b border-border bg-secondary/40 px-4 py-2.5 text-xs text-muted-foreground">
                  No winner was awarded.{' '}
                  {auction.reauctionReason ?? 'The round did not produce a valid result.'}
                </p>
              )}

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
                          {result.rank !== 1 ? (
                            <span className="text-xs text-muted-foreground">Runner-up</span>
                          ) : auction.winner ? (
                            <StatusBadge status={auction.winner.status} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Not awarded</span>
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

          {/* Re-auction chain */}
          {showLineage && (
            <TableCard>
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Re-auction chain</h2>
                <p className="text-xs text-muted-foreground">
                  {auction.reauctionEnabled
                    ? `Round ${auction.reauctionRound + 1} of at most ${auction.maxReauctionRounds + 1} · ${auction.reauctionDurationHours}h per re-run · ${
                        auction.reauctionAllowNewBidders ? 'new' : 'no new'
                      } bidders, ${
                        auction.reauctionAllowPreviousBidders ? 'previous' : 'no previous'
                      } bidders`
                    : 'Re-auction is switched off for this auction.'}
                </p>
              </div>

              {auction.reauctionReason && (
                <p className="border-b border-border bg-secondary/40 px-4 py-2.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {auction.reauctionState.replace(/_/g, ' ').toLowerCase()}
                  </span>{' '}
                  — {auction.reauctionReason}
                </p>
              )}

              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Round</th>
                    <th className="px-4 py-2.5 font-semibold">Auction</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Bids</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rounds.map((round) => (
                    <tr key={round.id} className={round.id === auction.id ? 'bg-primary/5' : ''}>
                      <td className="px-4 py-2.5 font-bold tabular-nums">
                        {round.reauctionRound === 0 ? 'Original' : `R${round.reauctionRound}`}
                      </td>
                      <td className="px-4 py-2.5">
                        {round.id === auction.id ? (
                          <span className="font-mono">#{round.code}</span>
                        ) : (
                          <Link
                            href={`/admin/auctions/${round.id}`}
                            className="font-mono hover:text-primary"
                          >
                            #{round.code}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {round.bidCount}
                        <span className="ml-1 text-xs text-muted-foreground">
                          / {round.bidderCount} bidder(s)
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={round.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {round.winnerBidId
                          ? 'Winner awarded'
                          : round.status === 'SETTLED'
                            ? round.reauctionState === 'CREATED'
                              ? 'No winner — re-auctioned'
                              : round.reauctionState === 'PENDING'
                                ? 'No winner — awaiting re-auction'
                                : 'No winner'
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}

          {/* Carried-forward bids */}
          {credits.length > 0 && (
            <TableCard>
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">Carried-forward bids</h2>
                <p className="text-xs text-muted-foreground">
                  {carriedGranted} paid bid(s) worth {carriedValue.toFixed(2)} {currency} carried
                  into this round for {credits.length} bidder(s); {carriedRemaining} still unspent.
                  These bids are not charged again.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Bidder</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Carried</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Used</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Left</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {credits.map((credit) => (
                    <tr key={credit.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/bidders/${credit.bidderId}`}
                          className="hover:text-primary"
                        >
                          {credit.bidder.fullName || maskPhone(credit.bidder.phoneNumber)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {credit.granted}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{credit.consumed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{credit.remaining}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {(credit.granted * toNum(credit.unitFee)).toFixed(2)} {currency}
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
              reauctionState: auction.reauctionState,
              reauctionRound: auction.reauctionRound,
              maxReauctionRounds: auction.maxReauctionRounds,
            }}
            canUpdate={canUpdate}
            canSettle={canSettle}
          />

          {/* Participation */}
          <TableCard>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <UserCheck className="h-4 w-4 text-muted-foreground" />
                Participation
              </h2>
              {canUpdate && (
                <Link
                  href={`/admin/auctions/${auction.id}/participants`}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Manage list →
                </Link>
              )}
            </div>

            <div className="space-y-2 px-4 py-3 text-sm">
              <p className="font-medium">
                {isRestricted(auction)
                  ? `Invited participants only — ${participantTotal.toLocaleString()} on the list`
                  : 'Open to every bidder'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isRestricted(auction)
                  ? 'Everyone can see this auction, but only the uploaded numbers can place a bid.'
                  : 'Upload a list of phone numbers to restrict it to invited participants.'}
              </p>

              {isRestricted(auction) && participantTotal === 0 && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                  The list is empty, so nobody can bid on this auction.
                </p>
              )}

              {unlisted > 0 && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                  {unlisted} bidder(s) already bid here but are not on the list — they cannot place
                  any more.
                </p>
              )}
            </div>
          </TableCard>

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
                [
                  'Who may bid',
                  isRestricted(auction)
                    ? `Invited only (${participantTotal.toLocaleString()})`
                    : 'Everyone',
                ],
                ['Max bids / bidder', String(auction.maxBidsPerUser)],
                [
                  'Max bids / auction',
                  auction.maxTotalBids > 0
                    ? `${auction.bidCount} / ${auction.maxTotalBids}`
                    : 'Unlimited',
                ],
                [
                  'Re-auction',
                  auction.reauctionEnabled
                    ? `On · up to ${auction.maxReauctionRounds} round(s) of ${auction.reauctionDurationHours}h`
                    : 'Off',
                ],
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
