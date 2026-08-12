import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { ItemForm } from '@/components/admin/item-form';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { parseImages, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit item' };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!hasPermission(user, 'items', 'update')) redirect('/admin/no-access');

  const { id } = await params;
  const [item, categories] = await Promise.all([
    prisma.item.findUnique({
      where: { id },
      include: { _count: { select: { auctions: true } } },
    }),
    prisma.category.findMany({
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  if (!item) notFound();

  return (
    <>
      <PageHeader
        title={item.name}
        breadcrumbs={[{ label: 'Items', href: '/admin/items' }, { label: item.name }]}
        description={`Used by ${item._count.auctions} auction(s)`}
      />
      <ItemForm
        mode="edit"
        categories={categories}
        canDelete={hasPermission(user, 'items', 'delete')}
        auctionCount={item._count.auctions}
        initial={{
          id: item.id,
          name: item.name,
          nameAm: item.nameAm ?? '',
          description: item.description,
          descriptionAm: item.descriptionAm ?? '',
          brand: item.brand ?? '',
          model: item.model ?? '',
          sku: item.sku ?? '',
          retailPrice: toNum(item.retailPrice),
          stockQty: item.stockQty,
          status: item.status,
          categoryId: item.categoryId,
          images: parseImages(item.images),
        }}
      />
    </>
  );
}
