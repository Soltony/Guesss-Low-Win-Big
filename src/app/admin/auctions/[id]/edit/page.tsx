import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { AuctionForm } from '@/components/admin/auction-form';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { reauctionDefaults } from '@/lib/reauction';
import { auctionHasBids } from '@/lib/auction-engine';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit auction' };

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function EditAuctionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!hasPermission(user, 'auctions', 'update')) redirect('/admin/no-access');

  const { id } = await params;
  const [auction, items, terms, settings, hasBids] = await Promise.all([
    prisma.auction.findUnique({ where: { id } }),
    prisma.item.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        category: { select: { name: true } },
      },
    }),
    prisma.termsAndConditions.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, version: true, active: true },
    }),
    getSettings(),
    // The same question the update endpoint asks, asked the same way, so the
    // screen never offers a field the API will refuse. `Auction.bidCount` is a
    // display figure refreshed by the maintenance pass, and on a live auction
    // it lags — long enough to show "no bids yet" over an auction that has them.
    auctionHasBids(id),
  ]);

  if (!auction) notFound();
  if (auction.status === 'SETTLED' || auction.status === 'CANCELLED') {
    redirect(`/admin/auctions/${id}`);
  }

  return (
    <>
      <PageHeader
        title={`Edit #${auction.code}`}
        breadcrumbs={[
          { label: 'Auctions', href: '/admin/auctions' },
          { label: `#${auction.code}`, href: `/admin/auctions/${id}` },
          { label: 'Edit' },
        ]}
        description={
          hasBids
            ? 'Bids have been placed, so the money rules and schedule are locked.'
            : 'No bids yet — every field can still be changed.'
        }
      />
      <AuctionForm
        mode="edit"
        economicsLocked={hasBids}
        items={items.map((item) => ({
          id: item.id,
          name: item.name,
          retailPrice: toNum(item.retailPrice),
          categoryName: item.category.name,
        }))}
        terms={terms}
        defaults={{
          bidFee: Number(settings['bidding.defaultBidFee']),
          minBidAmount: Number(settings['bidding.defaultMinBid']),
          maxBidAmount: Number(settings['bidding.defaultMaxBid']),
          bidStep: Number(settings['bidding.defaultBidStep']),
          maxBidsPerUser: Number(settings['bidding.defaultMaxBidsPerUser']),
          maxTotalBids: Number(settings['bidding.defaultMaxTotalBids']),
          durationDays: Number(settings['bidding.defaultDurationDays']),
          autoExtendMinutes: Number(settings['bidding.defaultAutoExtendMinutes']),
          currency: auction.currency,
          ...reauctionDefaults(settings),
        }}
        initial={{
          id: auction.id,
          itemId: auction.itemId,
          title: auction.title,
          titleAm: auction.titleAm ?? '',
          subtitle: auction.subtitle ?? '',
          bidFee: toNum(auction.bidFee),
          minBidAmount: toNum(auction.minBidAmount),
          maxBidAmount: toNum(auction.maxBidAmount),
          bidStep: toNum(auction.bidStep),
          maxBidsPerUser: auction.maxBidsPerUser,
          maxTotalBids: auction.maxTotalBids,
          autoExtendMinutes: auction.autoExtendMinutes,
          startAt: toLocalInput(auction.startAt),
          endAt: toLocalInput(auction.endAt),
          featured: auction.featured,
          displayOrder: auction.displayOrder,
          termsId: auction.termsId ?? '',
          reauctionEnabled: auction.reauctionEnabled,
          maxReauctionRounds: auction.maxReauctionRounds,
          reauctionDurationHours: auction.reauctionDurationHours,
          reauctionStartDelayMinutes: auction.reauctionStartDelayMinutes,
          reauctionAllowNewBidders: auction.reauctionAllowNewBidders,
          reauctionAllowPreviousBidders: auction.reauctionAllowPreviousBidders,
          reauctionMinBids: auction.reauctionMinBids,
        }}
      />
    </>
  );
}
