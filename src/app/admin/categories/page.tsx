import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { CategoryManager } from '@/components/admin/category-manager';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const [user, categories] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.category.findMany({
      orderBy: { displayOrder: 'asc' },
      include: { _count: { select: { items: true, auctions: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Categories"
        description="The grid shown at the top of the mini-app home page."
      />
      <CategoryManager
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          nameAm: category.nameAm ?? '',
          slug: category.slug,
          imageUrl: category.imageUrl ?? '',
          displayOrder: category.displayOrder,
          status: category.status,
          itemCount: category._count.items,
          auctionCount: category._count.auctions,
        }))}
        canCreate={hasPermission(user, 'categories', 'create')}
        canUpdate={hasPermission(user, 'categories', 'update')}
        canDelete={hasPermission(user, 'categories', 'delete')}
      />
    </>
  );
}
