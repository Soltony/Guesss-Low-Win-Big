'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Minus, Plus, ShieldCheck, XCircle } from 'lucide-react';
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
  const disabled = !isLive || phase === 'submitting' || phase === 'awaiting-payment';

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

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
            'We are still waiting for the payment confirmation. Check My Bids in a moment — if the fee was taken, your bid will appear there.'
          );
          return;
        }

        try {
          const response = await fetch(`/api/miniapp/bids/${bidId}/status`, {
            cache: 'no-store',
          });
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
          // Transient network blip inside the webview; the next tick retries.
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
        description: 'Please open HowLow from the super app to place a bid.',
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
      setMessage('Network error. Please check your connection and try again.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {t('bid.feeNotice', { fee: `${auction.bidFee.toFixed(2)} ${currency}` })}
        </span>
      </div>

      <div className="flex items-stretch overflow-hidden rounded-xl border border-input bg-card">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled}
          aria-label="Decrease bid amount"
          className="flex w-14 items-center justify-center border-r border-input text-foreground transition hover:bg-secondary disabled:opacity-40"
        >
          <Minus className="h-5 w-5" />
        </button>

        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
          placeholder={t('auction.bidAmount')}
          min={auction.minBidAmount}
          max={auction.maxBidAmount}
          step={auction.bidStep}
          aria-label={t('auction.bidAmount')}
          className="min-w-0 flex-1 bg-transparent px-3 py-4 text-center text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground disabled:opacity-60"
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled}
          aria-label="Increase bid amount"
          className="flex w-14 items-center justify-center border-l border-input text-foreground transition hover:bg-secondary disabled:opacity-40"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {t('auction.range')}: {auction.minBidAmount.toFixed(2)} – {auction.maxBidAmount.toFixed(2)}{' '}
        {currency} · {remaining} {t('auction.bidsLeft')}
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={disabled || remaining === 0}
        className={cn(
          'howlow-cta flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-bold text-white shadow-md transition active:scale-[0.99]',
          (disabled || remaining === 0) && 'cursor-not-allowed opacity-60'
        )}
      >
        {phase === 'submitting' || phase === 'awaiting-payment' ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
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

      {phase === 'awaiting-payment' && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-3 text-sm">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning" />
          <p>
            Approve the {auction.bidFee.toFixed(2)} {currency} service fee in your wallet. Your bid
            counts as soon as the payment is confirmed — keep this screen open.
          </p>
        </div>
      )}

      {phase === 'confirmed' && (
        <div className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p>
            {t('bid.confirmed')}. {t('bid.hiddenUntilEnd')}
          </p>
        </div>
      )}

      {phase === 'failed' && message && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{message}</p>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 rounded-xl bg-secondary/60 px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" />
        {t('auction.terms')}
      </div>
    </div>
  );
}
