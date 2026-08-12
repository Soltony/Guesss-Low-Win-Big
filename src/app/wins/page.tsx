import Link from 'next/link';
import { Lock, Trophy } from 'lucide-react';
import prisma from '@/lib/prisma';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { EmptyState } from '@/components/miniapp/section-heading';
import { WinsList } from '@/components/miniapp/wins-list';
import { getShellUser } from '@/lib/miniapp-user';
import { firstImage, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Wins' };

export default async function WinsPage() {
  const user = await getShellUser();

  if (!user) {
    return (
      <MiniAppShell user={null}>
        <div className="px-4 py-10">
          <EmptyState
            icon={Lock}
            title="Connect to see your wins"
            description="Open GuessLow from the super app so we can identify your account."
            action={
              <Link
                href="/connect"
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Connect
              </Link>
            }
          />
        </div>
      </MiniAppShell>
    );
  }

  const wins = await prisma.winner.findMany({
    where: { bidderId: user.bidderId },
    orderBy: { createdAt: 'desc' },
    include: {
      auction: {
        select: {
          code: true,
          title: true,
          currency: true,
          item: { select: { images: true, retailPrice: true } },
        },
      },
    },
  });

  const mapped = wins.map((win) => ({
    id: win.id,
    auctionCode: win.auction.code,
    title: win.auction.title,
    imageUrl: firstImage(win.auction.item.images),
    retailPrice: toNum(win.auction.item.retailPrice),
    amount: toNum(win.amount),
    currency: win.auction.currency,
    status: win.status,
    claimDeadline: win.claimDeadline?.toISOString() ?? null,
    claimedAt: win.claimedAt?.toISOString() ?? null,
    fulfilledAt: win.fulfilledAt?.toISOString() ?? null,
    deliveryName: win.deliveryName,
    deliveryPhone: win.deliveryPhone,
    deliveryAddress: win.deliveryAddress,
  }));

  return (
    <MiniAppShell user={user}>
      {mapped.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            icon={Trophy}
            title="No wins yet — keep bidding!"
            description="Every auction you enter is a chance to hold the lowest unique bid."
            action={
              <Link
                href="/auctions"
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Browse auctions
              </Link>
            }
          />
        </div>
      ) : (
        <WinsList wins={mapped} defaultPhone={user.phone} defaultName={user.fullName ?? ''} />
      )}
    </MiniAppShell>
  );
}
