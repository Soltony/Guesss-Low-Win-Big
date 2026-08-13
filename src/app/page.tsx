import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { HomeView } from '@/components/miniapp/home-view';
import { getHomeData } from '@/lib/miniapp-data';
import { getBidCountsByAuction, getFavoriteAuctionIds, getShellUser } from '@/lib/miniapp-user';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [user, home] = await Promise.all([getShellUser(), getHomeData()]);
  const [favorites, bidCounts] = await Promise.all([
    getFavoriteAuctionIds(user?.bidderId),
    getBidCountsByAuction(user?.bidderId),
  ]);

  return (
    <MiniAppShell
      user={user}
    >
      <HomeView
        tagline={String(home.settings['platform.tagline'] || '')}
        categories={home.categories}
        featured={home.featured}
        endingSoon={home.endingSoon}
        recentWinners={home.recentWinners}
        favorites={Array.from(favorites)}
        stats={home.stats}
        connected={Boolean(user)}
        bidCounts={bidCounts}
      />
    </MiniAppShell>
  );
}
