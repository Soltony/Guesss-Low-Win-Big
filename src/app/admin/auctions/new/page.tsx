import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { AuctionForm } from '@/components/admin/auction-form';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New auction' };

export default async function NewAuctionPage() {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!hasPermission(user, 'auctions', 'create')) redirect('/admin/no-access');

  const [items, terms, settings] = await Promise.all([
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
  ]);

  return (
    <>
      <PageHeader
        title="New auction"
        breadcrumbs={[{ label: 'Auctions', href: '/admin/auctions' }, { label: 'New' }]}
        description="Saved as a draft. Publishing is a separate, approvable step."
      />
      <AuctionForm
        mode="create"
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
          durationDays: Number(settings['bidding.defaultDurationDays']),
          autoExtendMinutes: Number(settings['bidding.defaultAutoExtendMinutes']),
          currency: String(settings['platform.currency'] || 'ETB'),
        }}
      />
    </>
  );
}
