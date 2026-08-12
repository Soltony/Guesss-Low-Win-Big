'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { TableCard, EmptyRow } from '@/components/admin/data-shell';
import { ImageUploader } from '@/components/admin/image-uploader';
import { useToast } from '@/hooks/use-toast';

export interface CategoryRow {
  id: string;
  name: string;
  nameAm: string;
  slug: string;
  imageUrl: string;
  displayOrder: number;
  status: string;
  itemCount: number;
  auctionCount: number;
}

const blank = {
  id: '',
  name: '',
  nameAm: '',
  slug: '',
  imageUrl: '',
  displayOrder: 0,
  status: 'ACTIVE',
};

export function CategoryManager({
  categories,
  canCreate,
  canUpdate,
  canDelete,
}: {
  categories: CategoryRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<typeof blank>(blank);

  const openCreate = () => {
    setForm({ ...blank, displayOrder: categories.length });
    setOpen(true);
  };

  const openEdit = (category: CategoryRow) => {
    setForm({
      id: category.id,
      name: category.name,
      nameAm: category.nameAm,
      slug: category.slug,
      imageUrl: category.imageUrl,
      displayOrder: category.displayOrder,
      status: category.status,
    });
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      const response = await fetch(
        editing ? `/api/admin/categories/${form.id}` : '/api/admin/categories',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: editing ? 'Category updated' : 'Category created' });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (category: CategoryRow) => {
    const response = await fetch(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Cannot delete', description: data?.error });
      return;
    }

    toast({ title: 'Category deleted' });
    router.refresh();
  };

  return (
    <>
      {canCreate && (
        <div className="mb-4">
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add category
          </Button>
        </div>
      )}

      <TableCard>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Order</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 font-semibold">Slug</th>
              <th className="px-4 py-2.5 text-right font-semibold">Items</th>
              <th className="px-4 py-2.5 text-right font-semibold">Auctions</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.length === 0 && (
              <EmptyRow colSpan={7} message="No categories yet." />
            )}
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                  {category.displayOrder}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {category.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={category.imageUrl}
                        alt=""
                        className="h-9 w-9 rounded-md object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      </span>
                    )}
                    <div>
                      <p className="font-medium">{category.name}</p>
                      {category.nameAm && (
                        <p className="text-xs text-muted-foreground">{category.nameAm}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {category.slug}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{category.itemCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{category.auctionCount}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={category.status} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    {canUpdate && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(category)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => remove(category)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>
              Categories drive the filter chips and the home page grid.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Name (English)</Label>
              <Input
                id="cat-name"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Mobile Phones"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-nameAm">Name (Amharic)</Label>
              <Input
                id="cat-nameAm"
                value={form.nameAm}
                onChange={(event) => setForm({ ...form, nameAm: event.target.value })}
              />
            </div>

            {!form.id && (
              <div className="space-y-1.5">
                <Label htmlFor="cat-slug">Slug</Label>
                <Input
                  id="cat-slug"
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value })}
                  placeholder="Generated from the name if left blank"
                />
              </div>
            )}

            <ImageUploader
              label="Category image"
              description="Shown in the mini-app category strip. Square artwork works best."
              value={form.imageUrl}
              onChange={(imageUrl) => setForm({ ...form, imageUrl })}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cat-order">Display order</Label>
                <Input
                  id="cat-order"
                  type="number"
                  value={form.displayOrder}
                  onChange={(event) =>
                    setForm({ ...form, displayOrder: Number(event.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-status">Status</Label>
                <select
                  id="cat-status"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
