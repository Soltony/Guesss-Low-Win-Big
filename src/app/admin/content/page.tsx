import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { ContentManager } from '@/components/admin/content-manager';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content' };

function toLocalInput(date: Date | null) {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function ContentPage() {
  const [user, banners, ads, terms, settings] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.banner.findMany({ orderBy: { displayOrder: 'asc' } }),
    prisma.advertisement.findMany({ orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.termsAndConditions.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { auctions: true } } },
    }),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Content"
        description="Home-page banners, mini-app ad popups, the terms & conditions shown to bidders, and the app icon."
      />
      <ContentManager
        banners={banners.map((banner) => ({
          id: banner.id,
          title: banner.title,
          titleAm: banner.titleAm ?? '',
          subtitle: banner.subtitle ?? '',
          imageUrl: banner.imageUrl,
          linkUrl: banner.linkUrl ?? '',
          displayOrder: banner.displayOrder,
          status: banner.status,
        }))}
        ads={ads.map((ad) => ({
          id: ad.id,
          title: ad.title,
          titleAm: ad.titleAm ?? '',
          body: ad.body ?? '',
          bodyAm: ad.bodyAm ?? '',
          imageUrl: ad.imageUrl ?? '',
          ctaLabel: ad.ctaLabel ?? '',
          ctaLabelAm: ad.ctaLabelAm ?? '',
          linkUrl: ad.linkUrl ?? '',
          frequency: ad.frequency,
          status: ad.status,
          displayOrder: ad.displayOrder,
          autoCloseSeconds: ad.autoCloseSeconds,
          minViewSeconds: ad.minViewSeconds,
          startAt: toLocalInput(ad.startAt),
          endAt: toLocalInput(ad.endAt),
          impressions: ad.impressions,
          clicks: ad.clicks,
        }))}
        adsEnabled={Boolean(settings['ads.enabled'])}
        adsPerLogin={Number(settings['ads.maxPerLogin']) || 1}
        terms={terms.map((term) => ({
          id: term.id,
          version: term.version,
          title: term.title,
          contentEn: term.contentEn,
          contentAm: term.contentAm ?? '',
          active: term.active,
          auctionCount: term._count.auctions,
          createdAt: term.createdAt.toISOString(),
        }))}
        logoUrl={String(settings['platform.logoUrl'] ?? '')}
        canCreate={hasPermission(user, 'content', 'create')}
        canUpdate={hasPermission(user, 'content', 'update')}
        canDelete={hasPermission(user, 'content', 'delete')}
        canEditBranding={hasPermission(user, 'settings', 'update')}
      />
    </>
  );
}
