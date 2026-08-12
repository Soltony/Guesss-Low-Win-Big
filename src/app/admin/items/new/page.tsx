import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { ItemForm } from '@/components/admin/item-form';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New item' };

export default async function NewItemPage() {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!hasPermission(user, 'items', 'create')) redirect('/admin/no-access');

  const categories = await prisma.category.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader
        title="New item"
        breadcrumbs={[{ label: 'Items', href: '/admin/items' }, { label: 'New' }]}
      />
      <ItemForm mode="create" categories={categories} />
    </>
  );
}
