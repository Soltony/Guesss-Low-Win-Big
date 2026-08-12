'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, Package, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ImageUploadButton } from '@/components/admin/image-uploader';
import { useToast } from '@/hooks/use-toast';

export interface ItemFormValues {
  id?: string;
  name: string;
  nameAm: string;
  description: string;
  descriptionAm: string;
  brand: string;
  model: string;
  sku: string;
  retailPrice: number;
  stockQty: number;
  status: string;
  categoryId: string;
  images: string[];
}

export function ItemForm({
  mode,
  categories,
  initial,
  canDelete = false,
  auctionCount = 0,
}: {
  mode: 'create' | 'edit';
  categories: { id: string; name: string }[];
  initial?: Partial<ItemFormValues>;
  canDelete?: boolean;
  auctionCount?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<ItemFormValues>({
    name: initial?.name ?? '',
    nameAm: initial?.nameAm ?? '',
    description: initial?.description ?? '',
    descriptionAm: initial?.descriptionAm ?? '',
    brand: initial?.brand ?? '',
    model: initial?.model ?? '',
    sku: initial?.sku ?? '',
    retailPrice: initial?.retailPrice ?? 0,
    stockQty: initial?.stockQty ?? 1,
    status: initial?.status ?? 'ACTIVE',
    categoryId: initial?.categoryId ?? categories[0]?.id ?? '',
    images: initial?.images ?? [],
  });
  const [imageInput, setImageInput] = useState('');

  const setField = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addImage = () => {
    const url = imageInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/uploads/')) {
      toast({ variant: 'destructive', title: 'Image URL must start with http:// or https://' });
      return;
    }
    if (form.images.includes(url)) return;
    setField('images', [...form.images, url].slice(0, 10));
    setImageInput('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        mode === 'create' ? '/api/admin/items' : `/api/admin/items/${initial?.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error || 'Could not save the item.');
        return;
      }

      toast({ title: mode === 'create' ? 'Item created' : 'Item updated' });
      router.push('/admin/items');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/items/${initial?.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Delete failed', description: data?.error });
        return;
      }

      toast({
        title: data.deactivated ? 'Item deactivated' : 'Item deleted',
        description: data.message,
      });
      router.push('/admin/items');
      router.refresh();
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name (English)</Label>
                  <Input
                    id="name"
                    required
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nameAm">Name (Amharic)</Label>
                  <Input
                    id="nameAm"
                    value={form.nameAm}
                    onChange={(event) => setField('nameAm', event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description (English)</Label>
                <Textarea
                  id="description"
                  required
                  rows={4}
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="descriptionAm">Description (Amharic)</Label>
                <Textarea
                  id="descriptionAm"
                  rows={3}
                  value={form.descriptionAm}
                  onChange={(event) => setField('descriptionAm', event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
              <CardDescription>
                First image is the thumbnail shown in the mini-app. Up to 10.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <ImageUploadButton
                  label="Upload images"
                  disabled={form.images.length >= 10}
                  onUploaded={(url) =>
                    setForm((prev) =>
                      prev.images.includes(url) || prev.images.length >= 10
                        ? prev
                        : { ...prev, images: [...prev.images, url] }
                    )
                  }
                />
                <span className="self-center text-xs text-muted-foreground">
                  or paste a URL
                </span>
              </div>

              <div className="flex gap-2">
                <Input
                  value={imageInput}
                  onChange={(event) => setImageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addImage();
                    }
                  }}
                  placeholder="https://…/product.png"
                />
                <Button type="button" variant="secondary" onClick={addImage}>
                  Add
                </Button>
              </div>

              {form.images.length === 0 ? (
                <p className="text-sm text-muted-foreground">No images added yet.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {form.images.map((url, index) => (
                    <li
                      key={url}
                      className="group relative overflow-hidden rounded-lg border border-border bg-secondary/40 p-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-16 w-full object-contain" />
                      {index === 0 && (
                        <span className="absolute left-1 top-1 rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          Main
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="Remove image"
                        onClick={() =>
                          setField(
                            'images',
                            form.images.filter((image) => image !== url)
                          )
                        }
                        className="absolute right-1 top-1 rounded bg-destructive p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="categoryId">Category</Label>
                <select
                  id="categoryId"
                  required
                  value={form.categoryId}
                  onChange={(event) => setField('categoryId', event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {categories.length === 0 && <option value="">No categories yet</option>}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="retailPrice">Retail price</Label>
                <Input
                  id="retailPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={form.retailPrice}
                  onChange={(event) => setField('retailPrice', Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Shown as the item&apos;s actual value in the mini-app.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stockQty">Stock quantity</Label>
                <Input
                  id="stockQty"
                  type="number"
                  min="0"
                  value={form.stockQty}
                  onChange={(event) => setField('stockQty', Number(event.target.value))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(event) => setField('status', event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identifiers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={form.brand}
                  onChange={(event) => setField('brand', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={form.model}
                  onChange={(event) => setField('model', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(event) => setField('sku', event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={saving || categories.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Create item' : 'Save changes'}
          </Button>

          {mode === 'edit' && canDelete && (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete item
            </Button>
          )}

          {categories.length === 0 && (
            <Alert variant="destructive">
              <Package className="h-4 w-4" />
              <AlertDescription>
                Create a category first — every item must belong to one.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </form>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {auctionCount > 0
                ? `This item is used by ${auctionCount} auction(s), so it will be deactivated instead of deleted — the auction history stays intact.`
                : 'This item is not used by any auction and will be permanently removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {auctionCount > 0 ? 'Deactivate' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
