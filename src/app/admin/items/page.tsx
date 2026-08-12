import Link from 'next/link';
import { Package, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { firstImage, toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Items' };

const PAGE_SIZE = 20;

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser({ allowRefresh: false });
  const page = Math.max(1, Number(params.page) || 1);
  const q = params.q?.trim();

  const where: any = {
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { brand: { contains: q } }] } : {}),
  };

  const [items, total, categories] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true } },
        _count: { select: { auctions: true } },
      },
    }),
    prisma.item.count({ where }),
    prisma.category.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Items"
        description="The prize catalogue. An auction always points at one item."
        actions={
          hasPermission(user, 'items', 'create') && (
            <Button asChild>
              <Link href="/admin/items/new">
                <Plus className="mr-1.5 h-4 w-4" />
                Add item
              </Link>
            </Button>
          )
        }
      />

      <FilterBar>
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="q" className="text-xs">
            Search
          </Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Name or brand" />
        </div>
        <div className="min-w-[180px]">
          <Label htmlFor="categoryId" className="text-xs">
            Category
          </Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={params.categoryId ?? ''}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </FilterBar>

      <TableCard>
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 text-right font-semibold">Retail price</th>
              <th className="px-4 py-2.5 text-right font-semibold">Stock</th>
              <th className="px-4 py-2.5 text-right font-semibold">Auctions</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 && (
              <EmptyRow colSpan={7} message="No items yet. Add one to start creating auctions." />
            )}
            {items.map((item) => {
              const image = firstImage(item.images);
              return (
                <tr key={item.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt=""
                          className="h-9 w-9 rounded-md object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/admin/items/${item.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {item.name}
                        </Link>
                        {item.brand && (
                          <p className="text-xs text-muted-foreground">{item.brand}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{item.category.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {toNum(item.retailPrice).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{item.stockQty}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{item._count.auctions}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/items/${item.id}`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/items"
          params={{ q, categoryId: params.categoryId }}
        />
      </TableCard>
    </>
  );
}
