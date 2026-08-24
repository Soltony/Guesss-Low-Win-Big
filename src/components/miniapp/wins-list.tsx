'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, PackageCheck, ScrollText, Trophy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MiniHero } from './section-heading';
import { BidLedgerSheet } from './bid-ledger-sheet';
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

const STATUS_STYLES: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
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

  const field =
    'w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring';

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
        className={field}
      />
      <input
        required
        value={form.deliveryPhone}
        onChange={(e) => setForm({ ...form, deliveryPhone: e.target.value })}
        placeholder="Contact phone number"
        className={field}
      />
      <textarea
        required
        rows={2}
        value={form.deliveryAddress}
        onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
        placeholder="Delivery address (city, sub-city, woreda, landmark)"
        className={field}
      />
      <textarea
        rows={2}
        value={form.deliveryNote}
        onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })}
        placeholder="Anything else we should know (optional)"
        className={field}
      />
      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Submit claim
      </button>
    </form>
  );
}

/**
 * The published record behind one win.
 *
 * Its own component so each row carries its own open state, rather than the
 * list tracking a map of them — and so the sheet, which fetches its summary
 * only when opened, stays inert until somebody actually asks.
 */
function WinLedger({ code, currency }: { code: string; currency: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mt-3 flex w-full items-center justify-between gap-2 border-t border-border pt-3 text-left text-xs font-bold transition-colors hover:text-primary"
      >
        <span className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          {t('ledger.open')}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      <BidLedgerSheet
        auctionCode={code}
        currency={currency}
        winnerName={t('ledger.youWon')}
        connected
        open={open}
        onOpenChange={setOpen}
      />
    </>
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
    <div className="pb-10">
      <MiniHero
        title={t('wins.title')}
        subtitle="Prizes you have taken with a lowest unique bid."
        icon={Trophy}
        stats={[
          { label: 'Wins', value: wins.length },
          { label: 'Paid', value: totalPaid.toFixed(2) },
          { label: 'Retail value', value: totalValue.toFixed(0) },
        ]}
      />

      <ul className="space-y-3 px-4 pt-4">
        {wins.map((win) => {
          const style = STATUS_STYLES[win.status] ?? {
            label: win.status,
            variant: 'secondary' as const,
          };
          const currency = win.currency === 'ETB' ? 'Br' : win.currency;
          const savings = win.retailPrice - win.amount;

          return (
            <li key={win.id} className="gl-card p-4">
              <div className="flex gap-3">
                <span className="gl-product h-14 w-14 shrink-0 rounded-xl">
                  {win.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={win.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <Trophy className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <Link href={`/auctions/${win.auctionCode}`}>
                    <p className="truncate text-sm font-medium hover:underline">{win.title}</p>
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    #{win.auctionCode}
                  </p>
                  <Badge variant={style.variant} className="mt-1.5">
                    {style.label}
                  </Badge>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-muted-foreground">{t('auction.winningBid')}</p>
                  <p className="text-lg font-semibold tabular-nums leading-tight">
                    {win.amount.toFixed(2)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {currency}
                    </span>
                  </p>
                  {savings > 0 && (
                    <p className="text-[11px] text-success">
                      saved {savings.toFixed(0)} {currency}
                    </p>
                  )}
                </div>
              </div>

              {win.status === 'PENDING_CLAIM' && (
                <>
                  {win.claimDeadline && (
                    <p className="mt-2 text-xs font-medium text-accent">
                      {t('wins.claimDeadline')}{' '}
                      {new Date(win.claimDeadline).toLocaleString('en-GB')}
                    </p>
                  )}
                  <ClaimForm win={win} defaultName={defaultName} defaultPhone={defaultPhone} />
                </>
              )}

              {(win.status === 'CLAIMED' || win.status === 'VERIFIED') && (
                <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>
                    Claim received for <strong className="text-foreground">{win.deliveryName}</strong> at{' '}
                    {win.deliveryAddress}. We will call {win.deliveryPhone}.
                  </span>
                </p>
              )}

              {win.status === 'FULFILLED' && (
                <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs font-medium text-success">
                  <PackageCheck className="h-3.5 w-3.5" />
                  Delivered{' '}
                  {win.fulfilledAt ? new Date(win.fulfilledAt).toLocaleDateString('en-GB') : ''}
                </p>
              )}

              <WinLedger code={win.auctionCode} currency={currency} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
