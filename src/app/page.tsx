import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { HomeView } from '@/components/miniapp/home-view';
import { getHomeData } from '@/lib/miniapp-data';
import { getBidCountsByAuction, getFavoriteAuctionIds, getShellUser } from '@/lib/miniapp-user';
import { carriedBidsByAuction } from '@/lib/reauction';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [user, home] = await Promise.all([getShellUser(), getHomeData()]);
  const [favorites, bidCounts, carriedBids] = await Promise.all([
    getFavoriteAuctionIds(user?.bidderId),
    getBidCountsByAuction(user?.bidderId),
    carriedBidsByAuction(user?.bidderId),
  ]);

  return (
    <MiniAppShell
      user={user}
    >
      <HomeView
        tagline={String(home.settings['platform.tagline'] || '')}
        banners={home.banners}
        categories={home.categories}
        featured={home.featured}
        endingSoon={home.endingSoon}
        recentWinners={home.recentWinners}
        favorites={Array.from(favorites)}
        stats={home.stats}
        connected={Boolean(user)}
        bidCounts={bidCounts}
        carriedBids={carriedBids}
      />
    </MiniAppShell>
  );
}
