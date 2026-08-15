'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Info, Loader2, Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

interface ItemOption {
  id: string;
  name: string;
  retailPrice: number;
  categoryName: string;
}

interface TermsOption {
  id: string;
  title: string;
  version: string;
  active: boolean;
}

export interface ParticipantListOption {
  id: string;
  name: string;
  entryCount: number;
}

export interface AuctionDefaults {
  bidFee: number;
  minBidAmount: number;
  maxBidAmount: number;
  bidStep: number;
  maxBidsPerUser: number;
  maxTotalBids: number;
  durationDays: number;
  autoExtendMinutes: number;
  currency: string;
  reauctionEnabled: boolean;
  maxReauctionRounds: number;
  reauctionDurationHours: number;
  reauctionStartDelayMinutes: number;
  reauctionAllowNewBidders: boolean;
  reauctionAllowPreviousBidders: boolean;
  reauctionMinBids: number;
}

export interface AuctionFormValues {
  id?: string;
  itemId: string;
  title: string;
  titleAm: string;
  subtitle: string;
  bidFee: number;
  minBidAmount: number;
  maxBidAmount: number;
  bidStep: number;
  maxBidsPerUser: number;
  maxTotalBids: number;
  autoExtendMinutes: number;
  startAt: string;
  endAt: string;
  featured: boolean;
  displayOrder: number;
  termsId: string;
  reauctionEnabled: boolean;
  maxReauctionRounds: number;
  reauctionDurationHours: number;
  reauctionStartDelayMinutes: number;
  reauctionAllowNewBidders: boolean;
  reauctionAllowPreviousBidders: boolean;
  reauctionMinBids: number;
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function AuctionForm({
  mode,
  items,
  terms,
  participantLists = [],
  defaults,
  initial,
  economicsLocked = false,
}: {
  mode: 'create' | 'edit';
  items: ItemOption[];
  terms: TermsOption[];
  /** Saved rosters from Content, offered when the auction is invited-only. */
  participantLists?: ParticipantListOption[];
  defaults: AuctionDefaults;
  initial?: Partial<AuctionFormValues>;
  economicsLocked?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who may bid. Picking a saved roster restricts the auction as part of this
  // save, because the numbers already exist and can simply be copied onto the
  // new draft. Leaving the roster on "upload a new list" keeps the older route:
  // the draft is created open, and the operator is taken straight to the page
  // that uploads a list, which is what switches it to invited-only.
  const [restricted, setRestricted] = useState(false);
  const [participantListId, setParticipantListId] = useState('');
  const usableLists = participantLists.filter((list) => list.entryCount > 0);

  const now = new Date();
  const [form, setForm] = useState<AuctionFormValues>({
    itemId: initial?.itemId ?? '',
    title: initial?.title ?? '',
    titleAm: initial?.titleAm ?? '',
    subtitle: initial?.subtitle ?? '',
    bidFee: initial?.bidFee ?? defaults.bidFee,
    minBidAmount: initial?.minBidAmount ?? defaults.minBidAmount,
    maxBidAmount: initial?.maxBidAmount ?? defaults.maxBidAmount,
    bidStep: initial?.bidStep ?? defaults.bidStep,
    maxBidsPerUser: initial?.maxBidsPerUser ?? defaults.maxBidsPerUser,
    maxTotalBids: initial?.maxTotalBids ?? defaults.maxTotalBids,
    autoExtendMinutes: initial?.autoExtendMinutes ?? defaults.autoExtendMinutes,
    startAt: initial?.startAt ?? toLocalInput(now),
    endAt:
      initial?.endAt ??
      toLocalInput(new Date(now.getTime() + defaults.durationDays * 86_400_000)),
    featured: initial?.featured ?? false,
    displayOrder: initial?.displayOrder ?? 0,
    termsId: initial?.termsId ?? terms.find((t) => t.active)?.id ?? '',
    reauctionEnabled: initial?.reauctionEnabled ?? defaults.reauctionEnabled,
    maxReauctionRounds: initial?.maxReauctionRounds ?? defaults.maxReauctionRounds,
    reauctionDurationHours:
      initial?.reauctionDurationHours ?? defaults.reauctionDurationHours,
    reauctionStartDelayMinutes:
      initial?.reauctionStartDelayMinutes ?? defaults.reauctionStartDelayMinutes,
    reauctionAllowNewBidders:
      initial?.reauctionAllowNewBidders ?? defaults.reauctionAllowNewBidders,
    reauctionAllowPreviousBidders:
      initial?.reauctionAllowPreviousBidders ?? defaults.reauctionAllowPreviousBidders,
    reauctionMinBids: initial?.reauctionMinBids ?? defaults.reauctionMinBids,
  });

  const selectedItem = items.find((item) => item.id === form.itemId);

  // How many distinct amounts the bid range allows — a small pool makes
  // duplicates near-certain and the "unique" mechanic collapses.
  const possibleAmounts = useMemo(() => {
    const step = Math.round(form.bidStep * 100);
    if (step <= 0) return 0;
    const span = Math.round(form.maxBidAmount * 100) - Math.round(form.minBidAmount * 100);
    return span < 0 ? 0 : Math.floor(span / step) + 1;
  }, [form.bidStep, form.maxBidAmount, form.minBidAmount]);

  const setField = <K extends keyof AuctionFormValues>(key: K, value: AuctionFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const attachList = mode === 'create' && restricted ? participantListId : '';

    const payload = {
      ...form,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
      termsId: form.termsId || null,
      titleAm: form.titleAm || null,
      subtitle: form.subtitle || null,
      ...(attachList ? { participantListId: attachList } : {}),
    };

    try {
      const response = await fetch(
        mode === 'create' ? '/api/admin/auctions' : `/api/admin/auctions/${initial?.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error || 'Could not save the auction.');
        return;
      }

      const auctionId = data.id ?? initial?.id;
      // Only send the operator off to the upload page when there is still a
      // list to supply — a saved roster has already been copied on by now.
      const uploadNext = mode === 'create' && restricted && !data.participants;

      toast({
        title: mode === 'create' ? 'Auction created' : 'Auction updated',
        variant: data.participantsError ? 'destructive' : undefined,
        description: data.participantsError
          ? `The auction was created, but the list could not be attached: ${data.participantsError}`
          : data.participants
            ? `Restricted to "${data.participants.listName}" — ${data.participants.total.toLocaleString()} invited participant(s).`
            : uploadNext
              ? 'Upload the invited list to restrict who can bid — until you do, the auction is open to everyone and cannot be published.'
              : undefined,
      });
      router.push(
        `/admin/auctions/${auctionId}${uploadNext || data.participantsError ? '/participants' : ''}`
      );
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
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
            <CardTitle>Item &amp; presentation</CardTitle>
            <CardDescription>What is being auctioned and how it reads in the app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="itemId">Item</Label>
              <select
                id="itemId"
                required
                disabled={economicsLocked}
                value={form.itemId}
                onChange={(event) => {
                  const item = items.find((i) => i.id === event.target.value);
                  setField('itemId', event.target.value);
                  if (item && !form.title) setField('title', item.name);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">Select an item…</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.categoryName} ({item.retailPrice.toFixed(2)}{' '}
                    {defaults.currency})
                  </option>
                ))}
              </select>
              {items.length === 0 && (
                <p className="text-xs text-destructive">
                  No active items yet — create one under Items first.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title (English)</Label>
              <Input
                id="title"
                required
                value={form.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="Calus TF20 Multi-Functional Power Bank & Wireless Headset"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="titleAm">Title (Amharic)</Label>
              <Input
                id="titleAm"
                value={form.titleAm}
                onChange={(event) => setField('titleAm', event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input
                id="subtitle"
                value={form.subtitle}
                onChange={(event) => setField('subtitle', event.target.value)}
                placeholder="Short line under the title"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bidding rules</CardTitle>
            <CardDescription>
              {economicsLocked
                ? 'Locked because bids have already been placed under these terms.'
                : 'Every value is per-auction and overrides the platform default.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bidFee">Bid service fee ({defaults.currency})</Label>
              <Input
                id="bidFee"
                type="number"
                step="0.01"
                min="0"
                required
                disabled={economicsLocked}
                value={form.bidFee}
                onChange={(event) => setField('bidFee', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxBidsPerUser">Max bids per bidder</Label>
              <Input
                id="maxBidsPerUser"
                type="number"
                min="1"
                required
                disabled={economicsLocked}
                value={form.maxBidsPerUser}
                onChange={(event) => setField('maxBidsPerUser', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxTotalBids">Max bids for the auction</Label>
              <Input
                id="maxTotalBids"
                type="number"
                min="0"
                disabled={economicsLocked}
                value={form.maxTotalBids}
                onChange={(event) => setField('maxTotalBids', Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Bidding closes once this many bids have been placed by everyone combined. 0 means
                unlimited.
              </p>
              {form.maxTotalBids > 0 && form.maxTotalBids < form.maxBidsPerUser && (
                <p className="text-xs text-destructive">
                  Lower than the per-bidder limit — a single bidder could exhaust the auction.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="minBidAmount">Minimum bid amount</Label>
              <Input
                id="minBidAmount"
                type="number"
                step="0.01"
                min="0.01"
                required
                disabled={economicsLocked}
                value={form.minBidAmount}
                onChange={(event) => setField('minBidAmount', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxBidAmount">Maximum bid amount</Label>
              <Input
                id="maxBidAmount"
                type="number"
                step="0.01"
                min="0.01"
                required
                disabled={economicsLocked}
                value={form.maxBidAmount}
                onChange={(event) => setField('maxBidAmount', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bidStep">Bid increment</Label>
              <Input
                id="bidStep"
                type="number"
                step="0.01"
                min="0.01"
                required
                disabled={economicsLocked}
                value={form.bidStep}
                onChange={(event) => setField('bidStep', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="autoExtendMinutes">Auto-extend window (minutes)</Label>
              <Input
                id="autoExtendMinutes"
                type="number"
                min="0"
                disabled={economicsLocked}
                value={form.autoExtendMinutes}
                onChange={(event) => setField('autoExtendMinutes', Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">0 disables anti-sniping extension.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Re-auction</CardTitle>
            <CardDescription>
              What happens when this auction closes without a valid winner. Every round inherits
              these rules, and bids a bidder already paid for carry into the next round free of
              charge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="reauctionEnabled">Re-auction when there is no winner</Label>
                <p className="text-xs text-muted-foreground">
                  Opens a fresh round automatically instead of closing the item unsold.
                </p>
              </div>
              <Switch
                id="reauctionEnabled"
                checked={form.reauctionEnabled}
                onCheckedChange={(checked) => setField('reauctionEnabled', checked)}
              />
            </div>

            {form.reauctionEnabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="maxReauctionRounds">Max re-auction rounds</Label>
                    <Input
                      id="maxReauctionRounds"
                      type="number"
                      min="1"
                      value={form.maxReauctionRounds}
                      onChange={(event) =>
                        setField('maxReauctionRounds', Number(event.target.value))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      After this many re-runs the auction closes with no winner.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reauctionDurationHours">Re-auction duration (hours)</Label>
                    <Input
                      id="reauctionDurationHours"
                      type="number"
                      min="1"
                      value={form.reauctionDurationHours}
                      onChange={(event) =>
                        setField('reauctionDurationHours', Number(event.target.value))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reauctionStartDelayMinutes">Start delay (minutes)</Label>
                    <Input
                      id="reauctionStartDelayMinutes"
                      type="number"
                      min="0"
                      value={form.reauctionStartDelayMinutes}
                      onChange={(event) =>
                        setField('reauctionStartDelayMinutes', Number(event.target.value))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Gap before the new round opens, so bidders get the notice first.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reauctionMinBids">Minimum bids for a valid result</Label>
                    <Input
                      id="reauctionMinBids"
                      type="number"
                      min="0"
                      value={form.reauctionMinBids}
                      onChange={(event) => setField('reauctionMinBids', Number(event.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      A round closing with fewer confirmed bids is re-auctioned instead of awarded.
                      0 disables the floor.
                    </p>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
                  <div>
                    <Label htmlFor="reauctionAllowNewBidders">New bidders may take part</Label>
                    <p className="text-xs text-muted-foreground">
                      When off, only bidders from an earlier round may bid in the re-run.
                    </p>
                  </div>
                  <Switch
                    id="reauctionAllowNewBidders"
                    checked={form.reauctionAllowNewBidders}
                    onCheckedChange={(checked) => setField('reauctionAllowNewBidders', checked)}
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label htmlFor="reauctionAllowPreviousBidders">
                      Previous bidders may take part
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      When off, everyone from the earlier rounds is excluded and nothing is carried
                      forward.
                    </p>
                  </div>
                  <Switch
                    id="reauctionAllowPreviousBidders"
                    checked={form.reauctionAllowPreviousBidders}
                    onCheckedChange={(checked) =>
                      setField('reauctionAllowPreviousBidders', checked)
                    }
                  />
                </div>

                {!form.reauctionAllowNewBidders && !form.reauctionAllowPreviousBidders && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      With both switches off nobody could bid in the re-auction. Allow at least one
                      group.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {mode === 'create' && (
          <Card>
            <CardHeader>
              <CardTitle>Participation</CardTitle>
              <CardDescription>
                Who is allowed to bid. An open auction is the norm; a restricted one admits only
                the phone numbers you upload.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="restricted">Invited participants only</Label>
                  <p className="text-xs text-muted-foreground">
                    Everyone still sees the auction in the app, but only the people on your list can
                    place a bid.
                  </p>
                </div>
                <Switch id="restricted" checked={restricted} onCheckedChange={setRestricted} />
              </div>

              {restricted && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="participantListId">Eligible participants</Label>
                    <select
                      id="participantListId"
                      value={participantListId}
                      onChange={(event) => setParticipantListId(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Upload a new list after saving…</option>
                      {usableLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} — {list.entryCount.toLocaleString()} number(s)
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Saved lists come from{' '}
                      <Link href="/admin/content" className="underline">
                        Content → Participant lists
                      </Link>
                      . Pick one instead of uploading the same numbers again.
                    </p>
                  </div>

                  <Alert>
                    <Lock className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {participantListId
                        ? 'The saved list is copied onto this auction when you save, and it becomes invited-only straight away. The copy is its own roster from then on — editing the saved list later will not change who can bid here, but the auction will offer you a re-sync.'
                        : 'Saving takes you straight to the upload page for this auction — a list can only be attached once the draft exists. The auction stays open to everyone, and cannot be published, until the list is in.'}
                    </AlertDescription>
                  </Alert>

                  {usableLists.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No saved lists with numbers on them yet — upload one under Content to reuse it
                      across auctions.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Times are in your local timezone.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="startAt">Starts</Label>
              <Input
                id="startAt"
                type="datetime-local"
                required
                disabled={economicsLocked}
                value={form.startAt}
                onChange={(event) => setField('startAt', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endAt">Ends</Label>
              <Input
                id="endAt"
                type="datetime-local"
                required
                disabled={economicsLocked}
                value={form.endAt}
                onChange={(event) => setField('endAt', event.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Placement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="featured">Featured</Label>
                <p className="text-xs text-muted-foreground">Show in the home Featured rail.</p>
              </div>
              <Switch
                id="featured"
                checked={form.featured}
                onCheckedChange={(checked) => setField('featured', checked)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="displayOrder">Display order</Label>
              <Input
                id="displayOrder"
                type="number"
                value={form.displayOrder}
                onChange={(event) => setField('displayOrder', Number(event.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="termsId">Terms &amp; conditions</Label>
              <select
                id="termsId"
                value={form.termsId}
                onChange={(event) => setField('termsId', event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">None</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.title} (v{term.version}){term.active ? ' — active' : ''}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sanity check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Possible amounts</span>
              <span className="font-semibold tabular-nums">
                {possibleAmounts.toLocaleString()}
              </span>
            </div>
            {possibleAmounts > 0 && possibleAmounts < 200 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Only {possibleAmounts} distinct amounts are possible. With many bidders almost
                  every amount will be duplicated and the auction may have no unique bid at all.
                  Consider widening the range or shrinking the increment.
                </AlertDescription>
              </Alert>
            )}
            {selectedItem && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Item retail value</span>
                  <span className="font-semibold tabular-nums">
                    {selectedItem.retailPrice.toFixed(2)} {defaults.currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Break-even bids</span>
                  <span className="font-semibold tabular-nums">
                    {form.bidFee > 0
                      ? Math.ceil(selectedItem.retailPrice / form.bidFee).toLocaleString()
                      : '—'}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" disabled={saving || items.length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === 'create'
            ? restricted
              ? 'Create draft & upload list'
              : 'Create draft'
            : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
