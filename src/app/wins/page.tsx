import Link from 'next/link';
import { Lock, Trophy } from 'lucide-react';
import prisma from '@/lib/prisma';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { EmptyState } from '@/components/miniapp/section-heading';
import { WinsList } from '@/components/miniapp/wins-list';
import { getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';
import { firstImage, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Wins' };

export default async function WinsPage() {
  const [user, settings] = await Promise.all([getShellUser(), getSettings()]);
  const supportPhone = String(settings['platform.supportPhone'] || '8080');

  if (!user) {
    return (
      <MiniAppShell user={null} supportPhone={supportPhone}>
        <div className="px-4 py-10">
          <EmptyState
            icon={Lock}
            title="Connect to see your wins"
            description="Open HowLow from the super app so we can identify your account."
            action={
              <Link
                href="/connect"
                className="howlow-cta rounded-xl px-5 py-2.5 text-sm font-bold text-white"
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
    <MiniAppShell user={user} supportPhone={supportPhone}>
      {mapped.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            icon={Trophy}
            title="No wins yet — keep bidding!"
            description="Every auction you enter is a chance to hold the lowest unique bid."
            action={
              <Link
                href="/auctions"
                className="howlow-cta rounded-xl px-5 py-2.5 text-sm font-bold text-white"
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
