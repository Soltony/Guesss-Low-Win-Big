import Link from 'next/link';
import { Lock } from 'lucide-react';
import prisma from '@/lib/prisma';
import { MiniAppShell } from '@/components/miniapp/mini-app-shell';
import { EmptyState } from '@/components/miniapp/section-heading';
import { ProfileView } from '@/components/miniapp/profile-view';
import { getShellUser } from '@/lib/miniapp-user';
import { getSettings } from '@/lib/settings';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const [user, settings] = await Promise.all([getShellUser(), getSettings()]);
  const supportPhone = String(settings['platform.supportPhone'] || '8080');

  if (!user) {
    return (
      <MiniAppShell user={null}>
        <div className="px-4 py-10">
          <EmptyState
            icon={Lock}
            title="Connect your account"
            description="Open GuessLow from the super app to see your profile."
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

  const [bidder, auctionsEntered, activeTerms] = await Promise.all([
    prisma.bidder.findUniqueOrThrow({
      where: { id: user.bidderId },
      select: {
        phoneNumber: true,
        fullName: true,
        language: true,
        status: true,
        totalBids: true,
        totalSpent: true,
        winsCount: true,
        createdAt: true,
      },
    }),
    prisma.bid.findMany({
      where: { bidderId: user.bidderId, status: 'ACTIVE' },
      select: { auctionId: true },
      distinct: ['auctionId'],
    }),
    prisma.termsAndConditions.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      select: { title: true, contentEn: true, contentAm: true },
    }),
  ]);

  return (
    <MiniAppShell user={user}>
      <ProfileView
        profile={{
          phone: bidder.phoneNumber,
          fullName: bidder.fullName,
          language: bidder.language === 'am' ? 'am' : 'en',
          status: bidder.status,
          totalBids: bidder.totalBids,
          totalSpent: toNum(bidder.totalSpent),
          winsCount: bidder.winsCount,
          auctionsEntered: auctionsEntered.length,
          memberSince: bidder.createdAt.toISOString(),
        }}
        supportPhone={supportPhone}
        terms={activeTerms}
      />
    </MiniAppShell>
  );
}
