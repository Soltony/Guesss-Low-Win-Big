import Link from 'next/link';
import { Gavel, Lock } from 'lucide-react';
import prisma from '@/lib/prisma';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { EmptyState } from '@/components/miniapp/section-heading';
import { MyBidsList } from '@/components/miniapp/my-bids-list';
import { getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';
import { isRevealAllowed } from '@/lib/auction-engine';
import { firstImage, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Bids' };

export default async function MyBidsPage() {
  const [user, settings] = await Promise.all([getShellUser(), getSettings()]);

  if (!user) {
    return (
      <MiniAppShell user={null}>
        <div className="px-4 py-10">
          <EmptyState
            icon={Lock}
            title="Connect to see your bids"
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

  const bids = await prisma.bid.findMany({
    where: { bidderId: user.bidderId, status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: {
      auction: {
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          endAt: true,
          currency: true,
          item: { select: { images: true } },
        },
      },
    },
  });

  // Group by auction so the list reads as "my entries", not a flat bid log.
  const revealCache = new Map<string, boolean>();
  const groups = new Map<
    string,
    {
      auctionId: string;
      code: string;
      title: string;
      status: string;
      endAt: string;
      currency: string;
      imageUrl: string | null;
      revealed: boolean;
      bids: {
        id: string;
        amount: number;
        feeAmount: number;
        status: string;
        sequence: number;
        createdAt: string;
        isUnique: boolean | null;
        rank: number | null;
      }[];
    }
  >();

  for (const bid of bids) {
    let revealed = revealCache.get(bid.auctionId);
    if (revealed === undefined) {
      revealed = await isRevealAllowed(bid.auction);
      revealCache.set(bid.auctionId, revealed);
    }

    if (!groups.has(bid.auctionId)) {
      groups.set(bid.auctionId, {
        auctionId: bid.auctionId,
        code: bid.auction.code,
        title: bid.auction.title,
        status: bid.auction.status,
        endAt: bid.auction.endAt.toISOString(),
        currency: bid.auction.currency,
        imageUrl: firstImage(bid.auction.item.images),
        revealed,
        bids: [],
      });
    }

    groups.get(bid.auctionId)!.bids.push({
      id: bid.id,
      amount: toNum(bid.amount),
      feeAmount: toNum(bid.feeAmount),
      status: bid.status,
      sequence: bid.sequence,
      createdAt: bid.createdAt.toISOString(),
      isUnique: revealed ? bid.isUnique : null,
      rank: revealed ? bid.rankAtSettlement : null,
    });
  }

  const entries = Array.from(groups.values());
  const totalSpent = bids
    .filter((b) => b.status === 'ACTIVE')
    .reduce((sum, b) => sum + toNum(b.feeAmount), 0);

  return (
    <MiniAppShell user={user}>
      {entries.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            icon={Gavel}
            title="No bids yet"
            description="Pick an auction, guess a low unique amount, and your bids will show up here."
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
        <MyBidsList entries={entries} totalSpent={totalSpent} />
      )}
    </MiniAppShell>
  );
}
