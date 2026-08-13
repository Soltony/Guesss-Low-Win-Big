'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Minus, Plus, ShieldCheck, X, XCircle, Zap } from 'lucide-react';
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
  /** Bids paid for in an earlier round that this bidder can still spend here. */
  carriedBids?: number;
  /** The re-auction rules exclude this bidder from the round. */
  blockedReason?: string | null;
  /**
   * `card` brings its own card chrome (the detail page); `inline` drops it and
   * sits flush inside a host card, which is how the list cards embed it.
   */
  variant?: 'card' | 'inline';
  /** Rendered as a close control in the header when the host can collapse it. */
  onClose?: () => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export function BidPanel({
  auction,
  connected,
  bidsUsed,
  carriedBids = 0,
  blockedReason = null,
  variant = 'card',
  onClose,
}: Props) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();

  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // Server-confirmed balance after each accepted bid, so the panel does not
  // promise a free bid the credit ledger has already spent.
  const [creditsLeft, setCreditsLeft] = useState(carriedBids);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Several cards can have their form open at once, so the field needs an id
  // of its own rather than a shared literal.
  const amountId = useId();

  /** Inline sits inside a list card, so it trims to the essentials. */
  const compact = variant === 'inline';
  /** Shared chrome for the awaiting/confirmed/failed notes under the button. */
  const noteClass = cn(
    'flex items-start gap-2 rounded-xl border px-3 py-2.5 leading-relaxed',
    compact ? 'mt-2 text-[11px]' : 'mt-3 text-xs'
  );
  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;
  const remaining = Math.max(0, auction.maxBidsPerUser - bidsUsed);
  const isLive = auction.status === 'LIVE';
  const busy = phase === 'submitting' || phase === 'awaiting-payment';
  const blocked = Boolean(blockedReason);
  // Only knowable when the bid count is public; the server enforces the cap
  // regardless, this just stops the form promising a bid it cannot take.
  const auctionFull =
    auction.maxTotalBids > 0 &&
    auction.bidCount !== null &&
    auction.bidCount >= auction.maxTotalBids;
  const disabled = !isLive || busy || blocked || auctionFull;
  /** The next bid is already paid for, so no wallet approval is coming. */
  const nextIsFree = creditsLeft > 0;

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

      if (typeof data.carriedBidsRemaining === 'number') {
        setCreditsLeft(data.carriedBidsRemaining);
      }

      if (data.status === 'ACTIVE') {
        setPhase('confirmed');
        setMessage(
          data.carriedOver
            ? 'Covered by a bid you already paid for in the previous round — no new fee was charged.'
            : null
        );
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
    <div className={cn(compact ? 'border-t border-border' : 'gl-card overflow-hidden')}>
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b border-border px-4',
          compact ? 'py-2' : 'py-2.5'
        )}
      >
        <p className={cn('flex items-center gap-1.5 font-bold', compact ? 'text-[13px]' : 'text-sm')}>
          <Zap className="h-4 w-4 text-primary" strokeWidth={2.5} />
          Place your bid
        </p>
        <div className="flex items-center gap-1.5">
          {nextIsFree && (
            <span className="gl-pill border-success/40 bg-success/10 text-success">
              {creditsLeft} free
            </span>
          )}
          <span className="gl-pill">
            {remaining} {t('auction.bidsLeft')}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bid form"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className={cn(compact ? 'p-3' : 'p-4')}>
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={disabled}
            aria-label="Decrease bid amount"
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-foreground transition-colors hover:bg-secondary disabled:opacity-40',
              compact ? 'w-11' : 'w-12'
            )}
          >
            <Minus className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
          </button>

          <div className="relative min-w-0 flex-1">
            <input
              id={amountId}
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
              className={cn(
                'w-full rounded-xl border-2 border-input bg-background px-3 pr-12 text-center font-extrabold tabular-nums outline-none transition-colors focus:border-primary disabled:opacity-60',
                compact ? 'h-12 text-2xl' : 'h-16 text-3xl'
              )}
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
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-foreground transition-colors hover:bg-secondary disabled:opacity-40',
              compact ? 'w-11' : 'w-12'
            )}
          >
            <Plus className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
          </button>
        </div>

        <p
          className={cn(
            'text-center text-muted-foreground',
            compact ? 'mt-2 text-[11px]' : 'mt-2.5 text-xs'
          )}
        >
          {auction.minBidAmount.toFixed(2)} – {auction.maxBidAmount.toFixed(2)} {currency}, in steps
          of {auction.bidStep.toFixed(2)}
        </p>

        <button
          type="button"
          onClick={submit}
          disabled={disabled || remaining === 0}
          className={cn(
            'gl-gold flex w-full items-center justify-center gap-2 rounded-xl px-4 font-bold',
            compact ? 'mt-2.5 py-3 text-sm' : 'mt-3 py-4 text-base',
            (disabled || remaining === 0) && 'cursor-not-allowed opacity-50'
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === 'submitting' ? 'Submitting…' : t('bid.confirming')}
            </>
          ) : blocked ? (
            'Not open to you'
          ) : !isLive ? (
            t('auction.ended')
          ) : auctionFull ? (
            'Auction bid limit reached'
          ) : remaining === 0 ? (
            'Bid limit reached'
          ) : nextIsFree ? (
            'Place bid — already paid'
          ) : (
            t('auction.submitBid')
          )}
        </button>

        {/* Inline has no room for the full notice plus a terms footer, so the
            fee disclosure and the terms line collapse into one row. */}
        {nextIsFree ? (
          <p
            className={cn(
              'text-center leading-tight text-muted-foreground',
              compact ? 'mt-2 text-[10px]' : 'mt-2.5 text-xs'
            )}
          >
            Your next {creditsLeft} bid{creditsLeft === 1 ? '' : 's'} carried over from the previous
            round and cost nothing. After that it is {auction.bidFee.toFixed(2)} {currency} per bid.
          </p>
        ) : compact ? (
          <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] leading-tight text-muted-foreground">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            {auction.bidFee.toFixed(2)} {currency} fee per bid · {t('auction.terms')}
          </p>
        ) : (
          <p className="mt-2.5 text-center text-xs text-muted-foreground">
            {t('bid.feeNotice', { fee: `${auction.bidFee.toFixed(2)} ${currency}` })}
          </p>
        )}

        {blockedReason && (
          <p className={cn(noteClass, 'border-border bg-secondary/60')}>
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>{blockedReason}</span>
          </p>
        )}

        {phase === 'awaiting-payment' && (
          <p className={cn(noteClass, 'border-accent/30 bg-accent/5')}>
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            <span>
              Approve the {auction.bidFee.toFixed(2)} {currency} fee in your wallet. Your bid counts
              the moment the payment clears — keep this screen open.
            </span>
          </p>
        )}

        {phase === 'confirmed' && (
          <p className={cn(noteClass, 'border-success/30 bg-success/5')}>
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <span>
              {t('bid.confirmed')}. {message ? `${message} ` : ''}
              {t('bid.hiddenUntilEnd')}
            </span>
          </p>
        )}

        {phase === 'failed' && message && (
          <p className={cn(noteClass, 'border-destructive/30 bg-destructive/5')}>
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span>{message}</span>
          </p>
        )}
      </div>

      {!compact && (
        <p className="flex items-center justify-center gap-1.5 border-t border-border bg-secondary/40 py-2.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('auction.terms')}
        </p>
      )}
    </div>
  );
}
