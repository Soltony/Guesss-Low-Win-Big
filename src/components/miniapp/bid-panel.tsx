'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  Coins,
  Gavel,
  Info,
  Loader2,
  Minus,
  Package,
  Plus,
  ScrollText,
  ShieldCheck,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from './language-provider';
import { round2 } from '@/lib/format';
import type { PublicAuction, PublicTerms } from '@/lib/miniapp-data';

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
  /**
   * Fires while a submission or a fee approval is in flight, so a host that can
   * be dismissed (the bid sheet) knows not to close out from under the poll.
   */
  onBusyChange?: (busy: boolean) => void;
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
  onBusyChange,
}: Props) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();

  const [amount, setAmount] = useState('');
  // The terms step sits between the submit button and the bid: nothing is sent
  // until the bidder has the terms in front of them and ticks the box.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // The full terms start folded away: the bid, the fee and the checkbox are
  // what the bidder came to check, and a wall of clauses above them buries all
  // three. Opening it is one tap for anyone who does want to read.
  const [termsOpen, setTermsOpen] = useState(false);
  const [terms, setTerms] = useState<PublicTerms | null>(null);
  const [termsLoaded, setTermsLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // The field is cleared on success so the next bid starts blank, so the amount
  // that was accepted has to be kept separately for the confirmation to name it.
  const [registeredAmount, setRegisteredAmount] = useState<number | null>(null);
  // Server-confirmed balance after each accepted bid, so the panel does not
  // promise a free bid the credit ledger has already spent.
  const [creditsLeft, setCreditsLeft] = useState(carriedBids);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  // Several cards can have their form open at once, so the field needs an id
  // of its own rather than a shared literal.
  const amountId = useId();

  /** Inline sits inside a list card, so it trims to the essentials. */
  const compact = variant === 'inline';
  /** Shared chrome for the blocked/awaiting/confirmed/failed notes. */
  const noteClass = cn(
    'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 leading-relaxed',
    compact ? 'mb-3 text-xs' : 'mb-3 text-sm'
  );
  /** Label cell in the confirmation dialog's bid summary. */
  const summaryLabel = 'flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground';
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

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // A result that arrives while the sheet is scrolled past it would still go
  // unread, so every outcome pulls itself into view.
  useEffect(() => {
    if (phase === 'idle' || phase === 'submitting') return;
    statusRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phase]);

  const step = (direction: 1 | -1) => {
    const current = Number(amount);
    const base = Number.isFinite(current) && amount !== '' ? current : auction.minBidAmount;
    const next = round2(base + direction * auction.bidStep);
    const clamped = Math.min(auction.maxBidAmount, Math.max(auction.minBidAmount, next));
    setAmount(clamped.toFixed(2));
  };

  const pollBidStatus = useCallback(
    (bidId: string, bidAmount: number) => {
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
            // What the ledger holds, not what was typed — the server rounds to
            // two places before it stores the bid.
            setRegisteredAmount(typeof data.amount === 'number' ? data.amount : bidAmount);
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

  /** Loaded once per panel, the first time the confirmation is opened. */
  const loadTerms = useCallback(async () => {
    if (termsLoaded) return;
    try {
      const response = await fetch(`/api/miniapp/terms?auctionId=${auction.id}`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        setTerms(data.terms ?? null);
      }
    } catch {
      // Left unset: the dialog falls back to the short notice, and the
      // acceptance step still has to be cleared either way.
    } finally {
      setTermsLoaded(true);
    }
  }, [auction.id, termsLoaded]);

  /**
   * The submit button now opens the terms step instead of placing the bid.
   * Everything that would reject the bid outright is still checked here, so the
   * bidder is not asked to accept terms for a bid that was never going to land.
   */
  const requestSubmit = () => {
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
      // Send them straight to the field. A note under the button reads as an
      // error about the button, and leaves the empty input to be hunted for.
      amountRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      amountRef.current?.focus();
      return;
    }

    // Acceptance is per bid, never carried over from the last one.
    setAccepted(false);
    setTermsOpen(false);
    setConfirmOpen(true);
    void loadTerms();
  };

  const submit = async (value: number) => {
    setPhase('submitting');
    setMessage(null);

    try {
      const response = await fetch('/api/miniapp/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: auction.id, amount: value, acceptedTerms: true }),
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
        setRegisteredAmount(typeof data.amount === 'number' ? data.amount : value);
        setAmount('');
        router.refresh();
        return;
      }

      setPhase('awaiting-payment');
      pollBidStatus(data.bidId, value);
    } catch {
      setPhase('failed');
      setMessage('Network error. Check your connection and try again.');
    }
  };

  const confirmAndSubmit = () => {
    if (!accepted) return;
    const value = Number(amount);
    if (!Number.isFinite(value)) return;
    setConfirmOpen(false);
    void submit(value);
  };

  const termsBody = terms
    ? (lang === 'am' && terms.contentAm ? terms.contentAm : terms.contentEn)
    : null;

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
        {/* The answer to "did my bid land?" leads the form. Under the submit
            button it was the last thing in a scrolling sheet, sitting on the
            bottom edge of the screen — the one place it reads as a footnote. */}
        <div ref={statusRef} aria-live="polite">
          {blockedReason && (
            <div className={cn(noteClass, 'border-border bg-secondary/60')}>
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{blockedReason}</span>
            </div>
          )}

          {phase === 'awaiting-payment' && (
            <div className={cn(noteClass, 'border-accent/40 bg-accent/10')}>
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent" />
              <span>
                <span className="block text-sm font-bold">{t('bid.confirming')}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Approve the {auction.bidFee.toFixed(2)} {currency} fee in your wallet. Your bid
                  counts the moment the payment clears — keep this open.
                </span>
              </span>
            </div>
          )}

          {phase === 'confirmed' && (
            <div className={cn(noteClass, 'border-success/40 bg-success/10')}>
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-success">{t('bid.confirmed')}</span>

                {/* The figure the bidder is trusting us with, read back to them
                    at the size they typed it — the field is blank again by now. */}
                {registeredAmount !== null && (
                  <span className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('bid.registered')}
                    </span>
                    <span className="text-xl font-extrabold leading-none tabular-nums">
                      {registeredAmount.toFixed(2)}
                      <span className="ml-1 text-xs font-semibold text-muted-foreground">
                        {currency}
                      </span>
                    </span>
                  </span>
                )}

                <span className="mt-1.5 block text-muted-foreground">
                  {message ? `${message} ` : ''}
                  {t('bid.hiddenUntilEnd')}
                </span>
              </span>
            </div>
          )}

          {phase === 'failed' && message && (
            <div className={cn(noteClass, 'border-destructive/40 bg-destructive/10')}>
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <span className="font-medium">{message}</span>
            </div>
          )}
        </div>

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
              ref={amountRef}
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
          onClick={requestSubmit}
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

      </div>

      {!compact && (
        <p className="flex items-center justify-center gap-1.5 border-t border-border bg-secondary/40 py-2.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('auction.terms')}
        </p>
      )}

      {/* ---------- Terms acceptance ----------
          Opened by the submit button; the bid is only sent from in here. The
          panel itself can already be inside the bid sheet's dialog, so this one
          layers above it. */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

          <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[88dvh] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_hsl(224_47%_9%/0.6)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Gavel className="h-[18px] w-[18px]" strokeWidth={2.5} />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-sm font-bold leading-tight">
                  {t('terms.confirmTitle')}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {t('terms.confirmIntro')}
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={t('common.close')}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {/* What is being committed to — item, bid, fee — read back line by
                  line before any of it is sent. */}
              <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <dt className={summaryLabel}>
                    <Package className="h-4 w-4 shrink-0" />
                    {t('terms.item')}:
                  </dt>
                  <dd className="min-w-0 text-right text-[13px] font-bold leading-snug text-primary">
                    {auction.title}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className={summaryLabel}>
                    <Coins className="h-4 w-4 shrink-0" />
                    {t('terms.yourBid')}:
                  </dt>
                  <dd className="shrink-0 text-lg font-extrabold leading-none tabular-nums text-success">
                    {(Number(amount) || 0).toFixed(2)}
                    <span className="ml-1 text-xs font-semibold">{currency}</span>
                  </dd>
                </div>

                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <dt className={cn(summaryLabel, 'mt-0.5')}>
                    <BadgeDollarSign className="h-4 w-4 shrink-0" />
                    {t('auction.bidFee')}:
                  </dt>
                  <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        'text-lg font-extrabold leading-none tabular-nums',
                        nextIsFree ? 'text-success' : 'text-destructive'
                      )}
                    >
                      {(nextIsFree ? 0 : auction.bidFee).toFixed(2)}
                      <span className="ml-1 text-xs font-semibold">{currency}</span>
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold leading-tight',
                        nextIsFree
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-destructive/40 bg-destructive/10 text-destructive'
                      )}
                    >
                      {nextIsFree ? t('terms.feeCovered') : t('terms.nonRefundable')}
                    </span>
                  </dd>
                </div>
              </dl>

              {/* What the fee buys and what it does not, in the bidder's words:
                  the amount typed above is not charged now, only the fee is. */}
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {nextIsFree && (
                    <span className="mb-1 block font-semibold text-success">
                      {t('bid.freeNotice')}
                    </span>
                  )}
                  {t('terms.feeExplainer')}
                </p>
              </div>

              <Collapsible.Root
                open={termsOpen}
                onOpenChange={setTermsOpen}
                className="mt-3 overflow-hidden rounded-xl border border-border"
              >
                <Collapsible.Trigger className="flex w-full items-center gap-2 bg-secondary/40 px-3 py-2.5 text-left text-xs font-bold transition-colors hover:bg-secondary">
                  <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {terms?.title || t('terms.title')}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    {termsOpen ? t('terms.hide') : t('terms.read')}
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 transition-transform', termsOpen && 'rotate-180')}
                    />
                  </span>
                </Collapsible.Trigger>

                <Collapsible.Content className="border-t border-border">
                  <div className="max-h-52 overflow-y-auto overscroll-contain px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    {!termsLoaded ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('common.loading')}
                      </span>
                    ) : termsBody ? (
                      <span className="whitespace-pre-line">{termsBody}</span>
                    ) : (
                      t('terms.unavailable')
                    )}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            </div>

            <div
              className="shrink-0 border-t border-border px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
            >
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs font-medium leading-relaxed transition-colors',
                  accepted ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-secondary/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span>{t('terms.accept')}</span>
              </label>

              <div className="mt-3 flex gap-2">
                <Dialog.Close className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold transition-colors hover:bg-secondary">
                  {t('common.cancel')}
                </Dialog.Close>
                <button
                  type="button"
                  onClick={confirmAndSubmit}
                  disabled={!accepted}
                  className={cn(
                    'gl-gold flex flex-[1.6] items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold',
                    !accepted && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {t('terms.confirmCta')}
                </button>
              </div>

              <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
                {t('terms.acceptRequired')}
              </p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
