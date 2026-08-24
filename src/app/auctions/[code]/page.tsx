import { notFound } from 'next/navigation';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { AuctionDetail } from '@/components/miniapp/auction-detail';
import {
  getAuctionByCode,
  getBidderAuctionContext,
  getMyBidsForAuction,
} from '@/lib/miniapp-data';
import { getFavoriteAuctionIds, getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';
import { isRevealAllowed } from '@/lib/auction-engine';
import { getLedgerOverview } from '@/lib/bid-ledger';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auction = await getAuctionByCode(code);
  return { title: auction?.title ?? 'Auction' };
}

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [auction, user, settings] = await Promise.all([
    getAuctionByCode(code),
    getShellUser(),
    getSettings(),
  ]);

  if (!auction) notFound();

  const [myBids, favorites, revealAllowed, bidderContext, ledger] = await Promise.all([
    user ? getMyBidsForAuction(user.bidderId, auction.id) : Promise.resolve([]),
    getFavoriteAuctionIds(user?.bidderId),
    isRevealAllowed({ status: auction.status, endAt: new Date(auction.endAt) }),
    user ? getBidderAuctionContext(user.bidderId, auction.id) : Promise.resolve(null),
    // Counts and the shape of the bid space only — the rows themselves are
    // paged in by the sheet, so an unopened ledger costs one small query.
    getLedgerOverview({
      id: auction.id,
      status: auction.status,
      currency: auction.currency,
    }),
  ]);

  return (
    <MiniAppShell user={user}>
      <AuctionDetail
        auction={auction}
        connected={Boolean(user)}
        myBids={myBids}
        favorited={favorites.has(auction.id)}
        revealAllowed={revealAllowed}
        ledger={ledger}
        carriedBids={bidderContext?.carriedBids ?? 0}
        blockedReason={bidderContext?.eligible === false ? bidderContext.eligibilityReason : null}
      />
    </MiniAppShell>
  );
}
