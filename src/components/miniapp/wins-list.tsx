'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, PackageCheck, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from './language-provider';
import { Badge } from '@/components/ui/badge';

interface Win {
  id: string;
  auctionCode: string;
  title: string;
  imageUrl: string | null;
  retailPrice: number;
  amount: number;
  currency: string;
  status: string;
  claimDeadline: string | null;
  claimedAt: string | null;
  fulfilledAt: string | null;
  deliveryName: string | null;
  deliveryPhone: string | null;
  deliveryAddress: string | null;
}

const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  PENDING_CLAIM: { label: 'Ready to claim', variant: 'warning' },
  CLAIMED: { label: 'Claim submitted', variant: 'secondary' },
  VERIFIED: { label: 'Verified', variant: 'default' },
  FULFILLED: { label: 'Delivered', variant: 'success' },
  FORFEITED: { label: 'Forfeited', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

function ClaimForm({
  win,
  defaultName,
  defaultPhone,
}: {
  win: Win;
  defaultName: string;
  defaultPhone: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    deliveryName: defaultName,
    deliveryPhone: defaultPhone,
    deliveryAddress: '',
    deliveryNote: '',
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch('/api/miniapp/wins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId: win.id, ...form }),
      });
      const data = await response.json();

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Claim failed', description: data?.error });
        return;
      }

      toast({
        title: 'Claim submitted',
        description: 'Our team will contact you to arrange delivery.',
      });
      router.refresh();
    } catch {
      toast({ variant: 'destructive', title: 'Network error', description: 'Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-border pt-3">
      <input
        required
        value={form.deliveryName}
        onChange={(e) => setForm({ ...form, deliveryName: e.target.value })}
        placeholder="Full name of the person collecting"
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <input
        required
        value={form.deliveryPhone}
        onChange={(e) => setForm({ ...form, deliveryPhone: e.target.value })}
        placeholder="Contact phone number"
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        required
        rows={2}
        value={form.deliveryAddress}
        onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
        placeholder="Delivery address (city, sub-city, woreda, landmark)"
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        rows={2}
        value={form.deliveryNote}
        onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })}
        placeholder="Anything else we should know (optional)"
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        disabled={submitting}
        className="howlow-cta flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Submit claim
      </button>
    </form>
  );
}

export function WinsList({
  wins,
  defaultName,
  defaultPhone,
}: {
  wins: Win[];
  defaultName: string;
  defaultPhone: string;
}) {
  const { t } = useLanguage();

  const totalValue = wins.reduce((sum, w) => sum + w.retailPrice, 0);
  const totalPaid = wins.reduce((sum, w) => sum + w.amount, 0);

  return (
    <div className="pb-6">
      <div className="howlow-hero px-4 py-5 text-white">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Trophy className="h-6 w-6" />
          {t('wins.title')}
        </h1>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{wins.length}</p>
            <p className="text-[11px] uppercase opacity-90">Wins</p>
          </div>
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{totalPaid.toFixed(2)}</p>
            <p className="text-[11px] uppercase opacity-90">Paid</p>
          </div>
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{totalValue.toFixed(0)}</p>
            <p className="text-[11px] uppercase opacity-90">Retail value</p>
          </div>
        </div>
      </div>

      <ul className="space-y-3 px-4 pt-4">
        {wins.map((win) => {
          const style = STATUS_STYLES[win.status] ?? {
            label: win.status,
            variant: 'secondary' as const,
          };
          const currency = win.currency === 'ETB' ? 'Br' : win.currency;
          const savings = win.retailPrice - win.amount;

          return (
            <li key={win.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex gap-3">
                {win.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={win.imageUrl}
                    alt=""
                    className="h-16 w-16 rounded-lg object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-secondary">
                    <Trophy className="h-7 w-7 text-accent" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <Link href={`/auctions/${win.auctionCode}`}>
                    <p className="truncate font-semibold hover:text-primary">{win.title}</p>
                  </Link>
                  <p className="text-xs text-muted-foreground">#{win.auctionCode}</p>
                  <Badge variant={style.variant} className="mt-1.5">
                    {style.label}
                  </Badge>
                </div>

                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t('auction.winningBid')}</p>
                  <p className="text-lg font-bold text-primary tabular-nums">
                    {win.amount.toFixed(2)} {currency}
                  </p>
                  {savings > 0 && (
                    <p className="text-[11px] font-medium text-success">
                      saved {savings.toFixed(0)} {currency}
                    </p>
                  )}
                </div>
              </div>

              {win.status === 'PENDING_CLAIM' && (
                <>
                  {win.claimDeadline && (
                    <p className="mt-2 text-xs font-medium text-warning">
                      {t('wins.claimDeadline')}{' '}
                      {new Date(win.claimDeadline).toLocaleString('en-GB')}
                    </p>
                  )}
                  <ClaimForm win={win} defaultName={defaultName} defaultPhone={defaultPhone} />
                </>
              )}

              {(win.status === 'CLAIMED' || win.status === 'VERIFIED') && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>
                    Claim received for <strong>{win.deliveryName}</strong> at {win.deliveryAddress}.
                    Our team will contact you on {win.deliveryPhone}.
                  </span>
                </p>
              )}

              {win.status === 'FULFILLED' && (
                <p
                  className={cn(
                    'mt-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success'
                  )}
                >
                  <PackageCheck className="h-4 w-4" />
                  Delivered{' '}
                  {win.fulfilledAt ? new Date(win.fulfilledAt).toLocaleDateString('en-GB') : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
