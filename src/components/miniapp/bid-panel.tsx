'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Minus, Plus, ShieldCheck, XCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from './language-provider';
import { round2 } from '@/lib/format';
import type { PublicAuction } from '@/lib/miniapp-data';

type Phase = 'idle' | 'submitting' | 'awaiting-payment' | 'confirmed' | 'failed';

interface Props {
  auction: PublicAuction;
  connected: boolean;
  bidsUsed: number;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export function BidPanel({ auction, connected, bidsUsed }: Props) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();

  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;
  const remaining = Math.max(0, auction.maxBidsPerUser - bidsUsed);
  const isLive = auction.status === 'LIVE';
  const busy = phase === 'submitting' || phase === 'awaiting-payment';
  const disabled = !isLive || busy;

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    []
  );

  const step = (direction: 1 | -1) => {
    const current = Number(amount);
    const base = Number.isFinite(current) && amount !== '' ? current : auction.minBidAmount;
    const next = round2(base + direction * auction.bidStep);
    const clamped = Math.min(auction.maxBidAmount, Math.max(auction.minBidAmount, next));
    setAmount(clamped.toFixed(2));
  };

  const pollBidStatus = useCallback(
    (bidId: string) => {
      const startedAt = Date.now();
      if (pollTimer.current) clearInterval(pollTimer.current);

      pollTimer.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(pollTimer.current!);
          setPhase('failed');
          setMessage(
            'Still waiting on the payment confirmation. Check My Bids shortly — if the fee was taken, your bid will be there.'
          );
          return;
        }

        try {
          const response = await fetch(`/api/miniapp/bids/${bidId}/status`, { cache: 'no-store' });
          if (!response.ok) return;
          const data = await response.json();

          if (data.status === 'ACTIVE') {
            clearInterval(pollTimer.current!);
            setPhase('confirmed');
            setMessage(null);
            setAmount('');
            router.refresh();
          } else if (data.status === 'FAILED' || data.status === 'VOID') {
            clearInterval(pollTimer.current!);
            setPhase('failed');
            setMessage(
              data.voidReason ||
                data.payment?.failureReason ||
                'The payment was not completed, so this bid was not counted.'
            );
          }
        } catch {
          // Transient blip inside the webview; the next tick retries.
        }
      }, POLL_INTERVAL_MS);
    },
    [router]
  );

  const submit = async () => {
    if (!connected) {
      toast({
        variant: 'destructive',
        title: 'Session required',
        description: 'Open GuessLow from the super app to place a bid.',
      });
      return;
    }

    const value = Number(amount);
    if (!amount || !Number.isFinite(value)) {
      setMessage('Enter a bid amount.');
      setPhase('failed');
      return;
    }

    setPhase('submitting');
    setMessage(null);

    try {
      const response = await fetch('/api/miniapp/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: auction.id, amount: value }),
      });
      const data = await response.json();

      if (!response.ok) {
        setPhase('failed');
        setMessage(data?.error || 'Your bid could not be placed.');
        return;
      }

      if (data.status === 'ACTIVE') {
        setPhase('confirmed');
        setAmount('');
        router.refresh();
        return;
      }

      setPhase('awaiting-payment');
      pollBidStatus(data.bidId);
    } catch {
      setPhase('failed');
      setMessage('Network error. Check your connection and try again.');
    }
  };

  return (
    <div className="gl-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Zap className="h-4 w-4 text-primary" strokeWidth={2.5} />
          Place your bid
        </p>
        <span className="gl-pill">
          {remaining} {t('auction.bidsLeft')}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={disabled}
            aria-label="Decrease bid amount"
            className="flex w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Minus className="h-5 w-5" />
          </button>

          <div className="relative min-w-0 flex-1">
            <input
              id="bid-amount"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={disabled}
              placeholder="0.00"
              aria-label={t('auction.bidAmount')}
              min={auction.minBidAmount}
              max={auction.maxBidAmount}
              step={auction.bidStep}
              className="h-16 w-full rounded-xl border-2 border-input bg-background px-3 pr-12 text-center text-3xl font-extrabold tabular-nums outline-none transition-colors focus:border-primary disabled:opacity-60"
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              {currency}
            </span>
          </div>

          <button
            type="button"
            onClick={() => step(1)}
            disabled={disabled}
            aria-label="Increase bid amount"
            className="flex w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2.5 text-center text-xs text-muted-foreground">
          {auction.minBidAmount.toFixed(2)} – {auction.maxBidAmount.toFixed(2)} {currency}, in steps
          of {auction.bidStep.toFixed(2)}
        </p>

        <button
          type="button"
          onClick={submit}
          disabled={disabled || remaining === 0}
          className={cn(
            'gl-gold mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-bold',
            (disabled || remaining === 0) && 'cursor-not-allowed opacity-50'
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === 'submitting' ? 'Submitting…' : t('bid.confirming')}
            </>
          ) : !isLive ? (
            t('auction.ended')
          ) : remaining === 0 ? (
            'Bid limit reached'
          ) : (
            t('auction.submitBid')
          )}
        </button>

        <p className="mt-2.5 text-center text-xs text-muted-foreground">
          {t('bid.feeNotice', { fee: `${auction.bidFee.toFixed(2)} ${currency}` })}
        </p>

        {phase === 'awaiting-payment' && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-xs leading-relaxed">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            <span>
              Approve the {auction.bidFee.toFixed(2)} {currency} fee in your wallet. Your bid counts
              the moment the payment clears — keep this screen open.
            </span>
          </p>
        )}

        {phase === 'confirmed' && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-xs leading-relaxed">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <span>
              {t('bid.confirmed')}. {t('bid.hiddenUntilEnd')}
            </span>
          </p>
        )}

        {phase === 'failed' && message && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span>{message}</span>
          </p>
        )}
      </div>

      <p className="flex items-center justify-center gap-1.5 border-t border-border bg-secondary/40 py-2.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('auction.terms')}
      </p>
    </div>
  );
}
