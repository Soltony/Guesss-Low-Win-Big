import prisma from '@/lib/prisma';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { AuctionsBrowser } from '@/components/miniapp/auctions-browser';
import { browseAuctions } from '@/lib/miniapp-data';
import { getFavoriteAuctionIds, getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Auctions' };

type Status = 'ALL' | 'LIVE' | 'ENDING_SOON' | 'ENDED';

export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const status = (['ALL', 'LIVE', 'ENDING_SOON', 'ENDED'] as const).includes(
    params.status as Status
  )
    ? (params.status as Status)
    : 'LIVE';

  const [user, categories, settings] = await Promise.all([
    getShellUser(),
    prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true, nameAm: true },
    }),
    getSettings(),
  ]);

  const { auctions, total } = await browseAuctions({
    categoryId: params.category,
    search: params.q,
    status,
    take: 48,
  });

  const favorites = await getFavoriteAuctionIds(user?.bidderId);

  return (
    <MiniAppShell user={user}>
      <AuctionsBrowser
        auctions={auctions}
        total={total}
        categories={categories}
        favorites={Array.from(favorites)}
        activeCategory={params.category ?? ''}
        activeStatus={status}
        query={params.q ?? ''}
      />
    </MiniAppShell>
  );
}
