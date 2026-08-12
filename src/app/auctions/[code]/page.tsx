import { notFound } from 'next/navigation';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { AuctionDetail } from '@/components/miniapp/auction-detail';
import { getAuctionByCode, getMyBidsForAuction } from '@/lib/miniapp-data';
import { getFavoriteAuctionIds, getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';
import { isRevealAllowed } from '@/lib/auction-engine';

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

  const [myBids, favorites, revealAllowed] = await Promise.all([
    user ? getMyBidsForAuction(user.bidderId, auction.id) : Promise.resolve([]),
    getFavoriteAuctionIds(user?.bidderId),
    isRevealAllowed({ status: auction.status, endAt: new Date(auction.endAt) }),
  ]);

  return (
    <MiniAppShell user={user} supportPhone={String(settings['platform.supportPhone'] || '8080')}>
      <AuctionDetail
        auction={auction}
        connected={Boolean(user)}
        myBids={myBids}
        favorited={favorites.has(auction.id)}
        revealAllowed={revealAllowed}
      />
    </MiniAppShell>
  );
}
