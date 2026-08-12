import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { ContentManager } from '@/components/admin/content-manager';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content' };

export default async function ContentPage() {
  const [user, banners, terms] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.banner.findMany({ orderBy: { displayOrder: 'asc' } }),
    prisma.termsAndConditions.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { auctions: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Content"
        description="Home-page banners and the terms & conditions shown to bidders."
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
        canCreate={hasPermission(user, 'content', 'create')}
        canUpdate={hasPermission(user, 'content', 'update')}
        canDelete={hasPermission(user, 'content', 'delete')}
      />
    </>
  );
}
