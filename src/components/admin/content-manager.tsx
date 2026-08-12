'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Images, Loader2, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyRow, TableCard } from '@/components/admin/data-shell';
import { ImageUploader } from '@/components/admin/image-uploader';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

export interface BannerRow {
  id: string;
  title: string;
  titleAm: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
  displayOrder: number;
  status: string;
}

export interface TermsRow {
  id: string;
  version: string;
  title: string;
  contentEn: string;
  contentAm: string;
  active: boolean;
  auctionCount: number;
  createdAt: string;
}

const blankBanner: BannerRow = {
  id: '',
  title: '',
  titleAm: '',
  subtitle: '',
  imageUrl: '',
  linkUrl: '',
  displayOrder: 0,
  status: 'ACTIVE',
};

const blankTerms = {
  id: '',
  version: '',
  title: 'GuessLow Auction Terms & Conditions',
  contentEn: '',
  contentAm: '',
  active: true,
};

export function ContentManager({
  banners,
  terms,
  canCreate,
  canUpdate,
  canDelete,
}: {
  banners: BannerRow[];
  terms: TermsRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [bannerForm, setBannerForm] = useState<BannerRow | null>(null);
  const [termsForm, setTermsForm] = useState<typeof blankTerms | null>(null);
  const [busy, setBusy] = useState(false);

  const saveBanner = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bannerForm) return;
    setBusy(true);
    try {
      const editing = Boolean(bannerForm.id);
      const response = await fetch(
        editing ? `/api/admin/content/${bannerForm.id}` : '/api/admin/content',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bannerForm, kind: 'banner' }),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: editing ? 'Banner updated' : 'Banner created' });
      setBannerForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveTerms = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!termsForm) return;
    setBusy(true);
    try {
      const editing = Boolean(termsForm.id);
      const response = await fetch(
        editing ? `/api/admin/content/${termsForm.id}` : '/api/admin/content',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...termsForm, kind: 'terms' }),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: editing ? 'Terms updated' : 'Terms version created' });
      setTermsForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const act = async (url: string, options: RequestInit, successTitle: string) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
      return;
    }
    toast({ title: successTitle });
    router.refresh();
  };

  return (
    <>
      <Tabs defaultValue="banners">
        <TabsList>
          <TabsTrigger value="banners">
            <Images className="mr-1.5 h-4 w-4" />
            Banners
          </TabsTrigger>
          <TabsTrigger value="terms">
            <ScrollText className="mr-1.5 h-4 w-4" />
            Terms &amp; conditions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="banners" className="mt-4">
          {canCreate && (
            <div className="mb-4">
              <Button
                onClick={() => setBannerForm({ ...blankBanner, displayOrder: banners.length })}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add banner
              </Button>
            </div>
          )}

          <TableCard>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Order</th>
                  <th className="px-4 py-2.5 font-semibold">Banner</th>
                  <th className="px-4 py-2.5 font-semibold">Link</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {banners.length === 0 && <EmptyRow colSpan={5} message="No banners yet." />}
                {banners.map((banner) => (
                  <tr key={banner.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {banner.displayOrder}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={banner.imageUrl}
                          alt=""
                          className="h-10 w-16 rounded object-cover"
                          loading="lazy"
                        />
                        <div>
                          <p className="font-medium">{banner.title}</p>
                          {banner.subtitle && (
                            <p className="text-xs text-muted-foreground">{banner.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-muted-foreground">
                      {banner.linkUrl || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={banner.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => setBannerForm(banner)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() =>
                              act(
                                `/api/admin/content/${banner.id}?kind=banner`,
                                { method: 'DELETE' },
                                'Banner deleted'
                              )
                            }
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
        </TabsContent>

        <TabsContent value="terms" className="mt-4">
          {canCreate && (
            <div className="mb-4">
              <Button
                onClick={() =>
                  setTermsForm({ ...blankTerms, version: `${new Date().getFullYear()}.1` })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                New version
              </Button>
            </div>
          )}

          <TableCard>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Version</th>
                  <th className="px-4 py-2.5 font-semibold">Title</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Auctions</th>
                  <th className="px-4 py-2.5 font-semibold">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {terms.length === 0 && <EmptyRow colSpan={5} message="No terms versions yet." />}
                {terms.map((term) => (
                  <tr key={term.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs font-semibold">{term.version}</span>
                      {term.active && (
                        <Badge variant="success" className="ml-2">
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{term.title}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{term.auctionCount}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(term.createdAt).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {canUpdate && !term.active && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              act(
                                `/api/admin/content/${term.id}`,
                                {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ kind: 'terms', activate: true }),
                                },
                                'Terms version activated'
                              )
                            }
                          >
                            Make active
                          </Button>
                        )}
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setTermsForm({
                                id: term.id,
                                version: term.version,
                                title: term.title,
                                contentEn: term.contentEn,
                                contentAm: term.contentAm,
                                active: term.active,
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && !term.active && term.auctionCount === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() =>
                              act(
                                `/api/admin/content/${term.id}?kind=terms`,
                                { method: 'DELETE' },
                                'Terms version deleted'
                              )
                            }
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
        </TabsContent>
      </Tabs>

      {/* Banner dialog */}
      <Dialog open={bannerForm !== null} onOpenChange={(open) => !open && setBannerForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bannerForm?.id ? 'Edit banner' : 'New banner'}</DialogTitle>
          </DialogHeader>

          {bannerForm && (
            <form onSubmit={saveBanner} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="b-title">Title</Label>
                <Input
                  id="b-title"
                  required
                  value={bannerForm.title}
                  onChange={(event) =>
                    setBannerForm({ ...bannerForm, title: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-subtitle">Subtitle</Label>
                <Input
                  id="b-subtitle"
                  value={bannerForm.subtitle}
                  onChange={(event) =>
                    setBannerForm({ ...bannerForm, subtitle: event.target.value })
                  }
                />
              </div>
              <ImageUploader
                label="Banner image"
                description="Wide artwork reads best — around 1200×480."
                required
                value={bannerForm.imageUrl}
                onChange={(imageUrl) => setBannerForm({ ...bannerForm, imageUrl })}
              />
              <div className="space-y-1.5">
                <Label htmlFor="b-link">Link URL</Label>
                <Input
                  id="b-link"
                  value={bannerForm.linkUrl}
                  onChange={(event) =>
                    setBannerForm({ ...bannerForm, linkUrl: event.target.value })
                  }
                  placeholder="/auctions/195"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="b-order">Display order</Label>
                  <Input
                    id="b-order"
                    type="number"
                    value={bannerForm.displayOrder}
                    onChange={(event) =>
                      setBannerForm({ ...bannerForm, displayOrder: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-status">Status</Label>
                  <select
                    id="b-status"
                    value={bannerForm.status}
                    onChange={(event) =>
                      setBannerForm({ ...bannerForm, status: event.target.value })
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setBannerForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Terms dialog */}
      <Dialog open={termsForm !== null} onOpenChange={(open) => !open && setTermsForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{termsForm?.id ? 'Edit terms' : 'New terms version'}</DialogTitle>
          </DialogHeader>

          {termsForm && (
            <form onSubmit={saveTerms} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-version">Version</Label>
                  <Input
                    id="t-version"
                    required
                    disabled={Boolean(termsForm.id)}
                    value={termsForm.version}
                    onChange={(event) =>
                      setTermsForm({ ...termsForm, version: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-title">Title</Label>
                  <Input
                    id="t-title"
                    required
                    value={termsForm.title}
                    onChange={(event) => setTermsForm({ ...termsForm, title: event.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-en">Content (English)</Label>
                <Textarea
                  id="t-en"
                  required
                  rows={8}
                  value={termsForm.contentEn}
                  onChange={(event) =>
                    setTermsForm({ ...termsForm, contentEn: event.target.value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-am">Content (Amharic)</Label>
                <Textarea
                  id="t-am"
                  rows={6}
                  value={termsForm.contentAm}
                  onChange={(event) =>
                    setTermsForm({ ...termsForm, contentAm: event.target.value })
                  }
                />
              </div>

              {!termsForm.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={termsForm.active}
                    onChange={(event) =>
                      setTermsForm({ ...termsForm, active: event.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  Make this the active version (replaces the current one)
                </label>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTermsForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
