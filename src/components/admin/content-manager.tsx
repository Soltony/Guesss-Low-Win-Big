'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  Images,
  Loader2,
  Megaphone,
  MousePointerClick,
  Palette,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  Users,
} from 'lucide-react';
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
import {
  ParticipantListManager,
  type ParticipantListRow,
} from '@/components/admin/participant-list-manager';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  AD_FREQUENCIES,
  AD_FREQUENCY_LABELS,
  MAX_MIN_VIEW_SECONDS,
  type AdFrequency,
} from '@/lib/types';
import { splitBrandName, useBrandName } from '@/components/brand-provider';
import type { TabPermission } from '@/lib/permissions';

const TAB_ICONS: Record<string, typeof Images> = {
  banners: Images,
  ads: Megaphone,
  terms: ScrollText,
  'participant-lists': Users,
  branding: Palette,
};

/** A tab the role does not reach at all — its section is never rendered. */
const NO_ACCESS = { canCreate: false, canUpdate: false, canDelete: false };

export interface BannerRow {
  id: string;
  title: string;
  titleAm: string;
  subtitle: string;
  imageUrl: string;
  /** What the artwork says, for anyone who cannot see it. '' = decorative. */
  imageAlt: string;
  linkUrl: string;
  displayOrder: number;
  status: string;
}

export interface AdRow {
  id: string;
  title: string;
  titleAm: string;
  body: string;
  bodyAm: string;
  imageUrl: string;
  /** What the artwork says, for anyone who cannot see it. '' = decorative. */
  imageAlt: string;
  ctaLabel: string;
  ctaLabelAm: string;
  linkUrl: string;
  frequency: string;
  status: string;
  displayOrder: number;
  autoCloseSeconds: number;
  minViewSeconds: number;
  /** `datetime-local` value, or '' when the ad runs open-ended. */
  startAt: string;
  endAt: string;
  impressions: number;
  clicks: number;
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
  imageAlt: '',
  linkUrl: '',
  displayOrder: 0,
  status: 'ACTIVE',
};

const blankAd: AdRow = {
  id: '',
  title: '',
  titleAm: '',
  body: '',
  bodyAm: '',
  imageUrl: '',
  imageAlt: '',
  ctaLabel: '',
  ctaLabelAm: '',
  linkUrl: '',
  frequency: 'ONCE_PER_DAY',
  status: 'ACTIVE',
  displayOrder: 0,
  autoCloseSeconds: 0,
  minViewSeconds: 0,
  startAt: '',
  endAt: '',
  impressions: 0,
  clicks: 0,
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
  ads,
  adsEnabled,
  adsPerLogin,
  terms,
  participantLists,
  logoUrl,
  tabs,
  canEditBranding,
}: {
  banners: BannerRow[];
  ads: AdRow[];
  /** `ads.enabled` — with it off nothing here is served, whatever is scheduled. */
  adsEnabled: boolean;
  adsPerLogin: number;
  terms: TermsRow[];
  /** Reusable rosters an invited-only auction can be built from. */
  participantLists: ParticipantListRow[];
  /** `platform.logoUrl` — '' means the built-in mark is in use. */
  logoUrl: string;
  /** The tabs this role may open, each with its own rights. Order is the registry's. */
  tabs: TabPermission[];
  /** The icon is a platform setting, so editing it needs the settings module. */
  canEditBranding: boolean;
}) {
  // The previews below stand in for the real shells, so they have to carry the
  // configured platform name rather than a baked-in one.
  const brandName = useBrandName();
  const [brandHead, brandTail] = splitBrandName(brandName);

  const byTab = new Map(tabs.map((tab) => [tab.tab, tab]));
  const bannerPerms = byTab.get('banners') ?? NO_ACCESS;
  const adPerms = byTab.get('ads') ?? NO_ACCESS;
  const termsPerms = byTab.get('terms') ?? NO_ACCESS;
  const listPerms = byTab.get('participant-lists') ?? NO_ACCESS;

  const router = useRouter();
  const { toast } = useToast();
  const [bannerForm, setBannerForm] = useState<BannerRow | null>(null);
  const [adForm, setAdForm] = useState<AdRow | null>(null);
  const [logoDraft, setLogoDraft] = useState(logoUrl);
  // Mirrors the server's servable test: active, and inside its run window.
  const now = Date.now();
  const liveAds = ads.filter(
    (ad) =>
      ad.status === 'ACTIVE' &&
      (!ad.startAt || new Date(ad.startAt).getTime() <= now) &&
      (!ad.endAt || new Date(ad.endAt).getTime() >= now)
  );
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

  const saveAd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adForm) return;

    if (!adForm.imageUrl && !adForm.body.trim()) {
      toast({
        variant: 'destructive',
        title: 'Nothing to show',
        description: 'Add artwork, a message, or both.',
      });
      return;
    }

    setBusy(true);
    try {
      const editing = Boolean(adForm.id);
      const response = await fetch(
        editing ? `/api/admin/content/${adForm.id}` : '/api/admin/content',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Empty date fields clear the schedule rather than being dropped.
          body: JSON.stringify({
            ...adForm,
            kind: 'ad',
            startAt: adForm.startAt || null,
            endAt: adForm.endAt || null,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({ title: editing ? 'Ad updated' : 'Ad created' });
      setAdForm(null);
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

  /** The icon lives in the settings registry, not in a content table, so it is
   *  saved through the settings endpoint that already audits every change. */
  const saveBranding = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { 'platform.logoUrl': logoDraft } }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Save failed', description: data?.error });
        return;
      }

      toast({
        title: data.changed ? 'App icon saved' : 'No changes to apply',
        description: data.changed
          ? 'Reload the page to see the new icon in the browser tab.'
          : undefined,
      });
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

  if (tabs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Your role opens this page but has no content sections on it. Ask an administrator to grant a
        tab under <strong>Content</strong> in Access Control.
      </div>
    );
  }

  return (
    <>
      <Tabs defaultValue={tabs[0].tab}>
        <TabsList>
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.tab];
            return (
              <TabsTrigger key={tab.tab} value={tab.tab}>
                {Icon && <Icon className="mr-1.5 h-4 w-4" />}
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {byTab.has('banners') && (
        <TabsContent value="banners" className="mt-4">
          {bannerPerms.canCreate && (
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
                        {bannerPerms.canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => setBannerForm(banner)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {bannerPerms.canDelete && (
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
        )}

        {byTab.has('ads') && (
        <TabsContent value="ads" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {adPerms.canCreate && (
              <Button onClick={() => setAdForm({ ...blankAd, displayOrder: ads.length })}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add ad
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Shown as a popup once a bidder opens the mini-app with a live session.{' '}
              {adsEnabled ? (
                <>
                  Up to <strong>{adsPerLogin}</strong> per visit —{' '}
                  <Link href="/admin/settings" className="underline">
                    change in Settings → Ads &amp; Popups
                  </Link>
                  .
                </>
              ) : (
                <>
                  <strong className="text-destructive">Popups are switched off</strong> in{' '}
                  <Link href="/admin/settings" className="underline">
                    Settings → Ads &amp; Popups
                  </Link>
                  , so nothing below is being served.
                </>
              )}
            </p>
          </div>

          {/* The commonest surprise: several ads live, but the per-visit cap
              only ever hands over the first. Say so before it is reported. */}
          {adsEnabled && liveAds.length > adsPerLogin && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                <strong>{liveAds.length} ads are live</strong>, but only{' '}
                <strong>{adsPerLogin}</strong> {adsPerLogin === 1 ? 'is' : 'are'} served per visit,
                so bidders see{' '}
                {adsPerLogin === 1 ? 'the first one only' : `the first ${adsPerLogin}`}. Raise{' '}
                <Link href="/admin/settings" className="underline">
                  Ads per app open
                </Link>{' '}
                to queue them in one visit.
              </p>
            </div>
          )}

          {adsEnabled && liveAds.length === 0 && ads.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                No ad is being served right now — every one below is either inactive or outside its
                run window. Clear the dates on an ad to run it until you switch it off.
              </p>
            </div>
          )}

          <TableCard>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Order</th>
                  <th className="px-4 py-2.5 font-semibold">Ad</th>
                  <th className="px-4 py-2.5 font-semibold">Frequency</th>
                  <th className="px-4 py-2.5 font-semibold">Schedule</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Views</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Clicks</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ads.length === 0 && <EmptyRow colSpan={8} message="No ads yet." />}
                {ads.map((ad) => (
                  <tr key={ad.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {ad.displayOrder}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {ad.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ad.imageUrl}
                            alt=""
                            className="h-10 w-16 rounded object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex h-10 w-16 items-center justify-center rounded bg-secondary">
                            <Megaphone className="h-4 w-4 text-muted-foreground" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium">{ad.title}</p>
                          {ad.linkUrl && (
                            <p className="max-w-[220px] truncate text-xs text-muted-foreground">
                              {ad.linkUrl}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {AD_FREQUENCY_LABELS[ad.frequency as AdFrequency] ?? ad.frequency}
                      {ad.minViewSeconds > 0 && (
                        <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                          {ad.minViewSeconds}s forced
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {ad.startAt || ad.endAt
                        ? `${ad.startAt ? ad.startAt.replace('T', ' ') : 'now'} → ${
                            ad.endAt ? ad.endAt.replace('T', ' ') : 'open'
                          }`
                        : 'Always'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{ad.impressions}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {ad.clicks > 0 && (
                          <MousePointerClick className="h-3 w-3 text-muted-foreground" />
                        )}
                        {ad.clicks}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={ad.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {adPerms.canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => setAdForm(ad)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {adPerms.canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() =>
                              act(
                                `/api/admin/content/${ad.id}?kind=ad`,
                                { method: 'DELETE' },
                                'Ad deleted'
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
        )}

        {byTab.has('terms') && (
        <TabsContent value="terms" className="mt-4">
          {termsPerms.canCreate && (
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
                        {termsPerms.canUpdate && !term.active && (
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
                        {termsPerms.canUpdate && (
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
                        {termsPerms.canDelete && !term.active && term.auctionCount === 0 && (
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
        )}

        {byTab.has('participant-lists') && (
        <TabsContent value="participant-lists" className="mt-4">
          <ParticipantListManager
            lists={participantLists}
            canCreate={listPerms.canCreate}
            canUpdate={listPerms.canUpdate}
            canDelete={listPerms.canDelete}
          />
        </TabsContent>
        )}

        {byTab.has('branding') && (
        <TabsContent value="branding" className="mt-4">
          <form onSubmit={saveBranding} className="max-w-2xl space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <ImageUploader
                label="App icon"
                description="Shown in the admin sidebar, the mini-app header, the sign-in screens and the browser tab. A square image reads best — around 512×512, with a transparent background if you have one. Remove it to go back to the built-in GuessLow mark."
                value={logoDraft}
                disabled={!canEditBranding}
                onChange={setLogoDraft}
              />
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Preview</p>
              <div className="flex flex-wrap gap-3">
                {/* Admin sidebar */}
                <div className="flex h-14 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoDraft || '/brand/logo'}
                    alt=""
                    className="h-7 w-7 rounded-lg object-contain"
                  />
                  <span className="text-lg font-semibold tracking-tight text-primary">
                    {brandName}
                  </span>
                </div>

                {/* Mini-app header */}
                <div className="flex h-14 min-w-[200px] flex-1 items-center gap-2 rounded-lg bg-foreground px-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoDraft || '/brand/logo'}
                    alt=""
                    className="h-8 w-8 rounded-lg object-contain"
                  />
                  <span className="text-[17px] font-bold tracking-tight text-background">
                    {brandHead}
                    {brandTail && <span className="text-primary">{brandTail}</span>}
                  </span>
                </div>

                {/* Browser tab */}
                <div className="flex h-14 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-secondary px-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoDraft || '/brand/logo'}
                    alt=""
                    className="h-4 w-4 rounded-sm object-contain"
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    Content | {brandName}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                The tab icon is cached by the browser — reload the page after saving to see it
                change.
              </p>
            </div>

            {canEditBranding ? (
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy || logoDraft === logoUrl}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save icon
                </Button>
                {logoDraft !== logoUrl && (
                  <Button type="button" variant="outline" onClick={() => setLogoDraft(logoUrl)}>
                    Discard
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                The app icon is a platform setting — you need permission to update{' '}
                <strong>Settings</strong> to change it.
              </p>
            )}
          </form>
        </TabsContent>
        )}
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
                <Label htmlFor="b-alt">Image description</Label>
                <Input
                  id="b-alt"
                  value={bannerForm.imageAlt}
                  onChange={(event) =>
                    setBannerForm({ ...bannerForm, imageAlt: event.target.value })
                  }
                  placeholder="e.g. 50% off bid fees this weekend"
                />
                <p className="text-xs text-muted-foreground">
                  Read aloud to bidders using a screen reader. Fill this in when the artwork
                  carries wording or an offer the title and subtitle do not already say. Leave it
                  empty when the image is purely decorative.
                </p>
              </div>
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

      {/* Ad dialog */}
      <Dialog open={adForm !== null} onOpenChange={(open) => !open && setAdForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{adForm?.id ? 'Edit ad' : 'New ad popup'}</DialogTitle>
          </DialogHeader>

          {adForm && (
            <form onSubmit={saveAd} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="a-title">Title (English)</Label>
                  <Input
                    id="a-title"
                    required
                    value={adForm.title}
                    onChange={(event) => setAdForm({ ...adForm, title: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-title-am">Title (Amharic)</Label>
                  <Input
                    id="a-title-am"
                    value={adForm.titleAm}
                    onChange={(event) => setAdForm({ ...adForm, titleAm: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="a-body">Message (English)</Label>
                  <Textarea
                    id="a-body"
                    rows={3}
                    value={adForm.body}
                    onChange={(event) => setAdForm({ ...adForm, body: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-body-am">Message (Amharic)</Label>
                  <Textarea
                    id="a-body-am"
                    rows={3}
                    value={adForm.bodyAm}
                    onChange={(event) => setAdForm({ ...adForm, bodyAm: event.target.value })}
                  />
                </div>
              </div>

              <ImageUploader
                label="Ad artwork"
                description="Portrait or square reads best in a popup — around 800×800. Optional if the ad carries a message."
                value={adForm.imageUrl}
                onChange={(imageUrl) => setAdForm({ ...adForm, imageUrl })}
              />

              {adForm.imageUrl && (
                <div className="space-y-1.5">
                  <Label htmlFor="a-alt">Image description</Label>
                  <Input
                    id="a-alt"
                    value={adForm.imageAlt}
                    onChange={(event) => setAdForm({ ...adForm, imageAlt: event.target.value })}
                    placeholder="e.g. Poster reading “Double your bids, Friday only”"
                  />
                  <p className="text-xs text-muted-foreground">
                    Read aloud to bidders using a screen reader. Advertiser artwork usually has
                    its message inside the image — describe it here unless the title and body
                    below already say the same thing.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="a-link">Link URL</Label>
                  <Input
                    id="a-link"
                    value={adForm.linkUrl}
                    onChange={(event) => setAdForm({ ...adForm, linkUrl: event.target.value })}
                    placeholder="/auctions/195 or https://…"
                  />
                  <p className="text-xs text-muted-foreground">
                    A path opens inside the mini-app; a full URL opens in a new tab. Leave blank for
                    an announcement with no button.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-cta">Button label (English)</Label>
                  <Input
                    id="a-cta"
                    value={adForm.ctaLabel}
                    onChange={(event) => setAdForm({ ...adForm, ctaLabel: event.target.value })}
                    placeholder="Bid now"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-cta-am">Button label (Amharic)</Label>
                  <Input
                    id="a-cta-am"
                    value={adForm.ctaLabelAm}
                    onChange={(event) => setAdForm({ ...adForm, ctaLabelAm: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-frequency">Show it</Label>
                  <select
                    id="a-frequency"
                    value={adForm.frequency}
                    onChange={(event) => setAdForm({ ...adForm, frequency: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {AD_FREQUENCIES.map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {AD_FREQUENCY_LABELS[frequency]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="a-start">Runs from</Label>
                  <Input
                    id="a-start"
                    type="datetime-local"
                    value={adForm.startAt}
                    onChange={(event) => setAdForm({ ...adForm, startAt: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-end">Runs until</Label>
                  <Input
                    id="a-end"
                    type="datetime-local"
                    value={adForm.endAt}
                    onChange={(event) => setAdForm({ ...adForm, endAt: event.target.value })}
                  />
                </div>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">
                Leave both blank to run the ad until you switch it off.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="a-minview">Forced view (seconds)</Label>
                  <Input
                    id="a-minview"
                    type="number"
                    min={0}
                    max={MAX_MIN_VIEW_SECONDS}
                    value={adForm.minViewSeconds}
                    onChange={(event) =>
                      setAdForm({ ...adForm, minViewSeconds: Number(event.target.value) })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The close button counts down and stays locked this long. 0 lets the bidder
                    dismiss it at once; {MAX_MIN_VIEW_SECONDS}s is the maximum.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-autoclose">Auto-close after (seconds)</Label>
                  <Input
                    id="a-autoclose"
                    type="number"
                    min={0}
                    max={120}
                    value={adForm.autoCloseSeconds}
                    onChange={(event) =>
                      setAdForm({ ...adForm, autoCloseSeconds: Number(event.target.value) })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Dismisses itself after this long. 0 leaves it up until the bidder closes it, and
                    it can never be shorter than the forced view.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-order">Display order</Label>
                  <Input
                    id="a-order"
                    type="number"
                    value={adForm.displayOrder}
                    onChange={(event) =>
                      setAdForm({ ...adForm, displayOrder: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-status">Status</Label>
                  <select
                    id="a-status"
                    value={adForm.status}
                    onChange={(event) => setAdForm({ ...adForm, status: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              </div>

              {adForm.id && (
                <p className="text-xs text-muted-foreground">
                  {adForm.impressions} view(s) · {adForm.clicks} click(s) so far.
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAdForm(null)}>
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
