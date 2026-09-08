'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Gavel, Loader2, Package, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from './language-provider';

/**
 * `waiting` covers the whole hand-off: the token going out over the super
 * app's JS channel, the PIN sheet, and the gateway's callback reaching us. A
 * failure the gateway reports is *also* shown as `waiting` for a grace period
 * before it resolves to `failed` — see `payment-watcher`.
 */
export type PaymentStatus = 'waiting' | 'success' | 'failed';

interface Props {
  open: boolean;
  status: PaymentStatus;
  /** The bid being paid for, echoed back so the screen names what is at stake. */
  amount: number | null;
  fee: number;
  currency: string;
  auctionTitle: string;
  auctionCode: string;
  imageUrl: string | null;
  /** Bids left on this auction once this one is counted. */
  remainingBids: number | null;
  /** Why the payment failed, when the panel has a reason from the gateway. */
  message: string | null;
  /** Only reachable once the payment has settled either way. */
  onDone: () => void;
}

/** Per-state palette, so the whole screen commits to one colour at a time. */
const TONE = {
  waiting: { token: 'accent', ring: 'border-accent/25', wash: 'bg-accent/10' },
  success: { token: 'success', ring: 'border-success/25', wash: 'bg-success/10' },
  failed: { token: 'destructive', ring: 'border-destructive/25', wash: 'bg-destructive/10' },
} as const;

/** One figure in the summary card. `lead` is the number the screen is about. */
function Row({
  label,
  value,
  unit,
  lead = false,
}: {
  label: string;
  value: string;
  unit?: string;
  lead?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-extrabold leading-none tabular-nums',
          lead ? 'text-[22px]' : 'text-sm text-muted-foreground'
        )}
      >
        {value}
        {unit && (
          <span className={cn('ml-1 text-[11px] font-semibold', lead && 'text-muted-foreground')}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The payment as a screen of its own, from the wallet hand-off to the verdict.
 *
 * The fee is collected by the super app, not by us: once the token goes over
 * the JS channel the bidder leaves our webview for the host's PIN sheet and
 * comes back to whatever we were showing. A note tucked into the bid form was
 * the wrong thing to come back to — it sits under a form that still looks
 * editable, so the bid reads as un-placed while the charge is in flight. A
 * full screen has one thing on it, survives the trip out to the wallet and
 * back, and cannot be typed into while the answer is still unknown.
 */
export function PaymentStatusPage({
  open,
  status,
  amount,
  fee,
  currency,
  auctionTitle,
  auctionCode,
  imageUrl,
  remainingBids,
  message,
  onDone,
}: Props) {
  const { t } = useLanguage();
  const settled = status !== 'waiting';
  const tone = TONE[status];

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        {/* Opaque, not a scrim: this is a page, and anything showing through
            it is something the bidder might try to tap mid-payment. */}
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-background data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-describedby={undefined}
          // Nothing dismisses this while the money is in flight — not the
          // backdrop, not Escape. A way out appears once there is an outcome
          // to accept.
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (!settled) event.preventDefault();
          }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto px-6 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)',
          }}
        >
          {/* Colour wash behind the badge, so the state is legible before a
              single word is read. Sits under the content, never over it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[60%]"
            style={{
              background: `radial-gradient(62% 52% at 50% 20%, hsl(var(--${tone.token}) / 0.14), transparent 72%)`,
            }}
          />

          <div className="relative flex w-full max-w-sm flex-col items-center text-center">
            {/* ---------- The badge ---------- */}
            <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
              {/* Only the wait animates. A verdict that keeps pulsing reads as
                  though it were still deciding something. */}
              {status === 'waiting' && (
                <span
                  aria-hidden
                  className="absolute inset-1 animate-ping rounded-full bg-accent/20"
                  style={{ animationDuration: '2.2s' }}
                />
              )}
              <span aria-hidden className={cn('absolute inset-0 rounded-full', tone.wash)} />
              <span
                className={cn(
                  'relative flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-full border-2 bg-card shadow-[0_10px_30px_-12px_hsl(224_47%_9%/0.35)]',
                  tone.ring,
                  settled && 'animate-in zoom-in-50 duration-500'
                )}
              >
                {status === 'waiting' && (
                  <Loader2 className="h-10 w-10 animate-spin text-accent" strokeWidth={2.25} />
                )}
                {status === 'success' && (
                  <CheckCircle2 className="h-11 w-11 text-success" strokeWidth={2.25} />
                )}
                {status === 'failed' && (
                  <XCircle className="h-11 w-11 text-destructive" strokeWidth={2.25} />
                )}
              </span>
            </div>

            {/* ---------- The verdict ----------
                Announced rather than merely drawn: the bidder may well be
                looking at the wallet's own sheet when this flips. */}
            <div aria-live="polite" className="w-full">
              <Dialog.Title
                className={cn(
                  'mt-6 text-[26px] font-extrabold leading-tight tracking-tight',
                  status === 'success' && 'text-success',
                  status === 'failed' && 'text-destructive'
                )}
              >
                {status === 'waiting' && t('bid.confirming')}
                {status === 'success' && t('bid.confirmed')}
                {status === 'failed' && t('bid.failed')}
              </Dialog.Title>

              <p className="mx-auto mt-2 max-w-[19rem] text-sm leading-relaxed text-muted-foreground">
                {status === 'waiting' &&
                  t('pay.approveHint', { fee: `${fee.toFixed(2)} ${currency}` })}
                {status === 'success' && t('bid.hiddenUntilEnd')}
                {status === 'failed' && (message || t('pay.failedFallback'))}
              </p>
            </div>

            {/* ---------- What is being paid for ---------- */}
            <div className="gl-card mt-7 w-full overflow-hidden text-left">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="gl-media h-12 w-12 shrink-0">
                  {imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={imageUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.5} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-bold leading-snug">{auctionTitle}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                    #{auctionCode}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 border-t border-border bg-secondary/30 px-4 py-3.5">
                <Row
                  lead
                  label={status === 'success' ? t('bid.registered') : t('auction.bidAmount')}
                  value={amount !== null ? amount.toFixed(2) : '—'}
                  unit={currency}
                />
                <Row label={t('pay.serviceFee')} value={fee.toFixed(2)} unit={currency} />

                {/* Only ever the server's own count. Guessing at it here would
                    put a number in front of the bidder that the next screen
                    they open could contradict. */}
                {remainingBids !== null && (
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-2.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Gavel className="h-3.5 w-3.5" strokeWidth={2.5} />
                      {t('pay.bidsRemaining')}
                    </span>
                    <span
                      className={cn(
                        'gl-pill tabular-nums',
                        remainingBids > 0
                          ? 'border-primary/40 bg-primary/10 font-bold'
                          : 'text-muted-foreground'
                      )}
                    >
                      {remainingBids}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* ---------- The way out ---------- */}
            {status === 'waiting' ? (
              <p className="mt-6 flex items-start gap-2 rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-left text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {t('pay.keepOpen')}
              </p>
            ) : (
              <button
                type="button"
                onClick={onDone}
                autoFocus
                className={cn(
                  'mt-6 w-full rounded-xl px-4 py-3.5 text-base font-bold transition-colors',
                  status === 'success'
                    ? 'gl-gold'
                    : 'border border-border bg-card text-foreground hover:bg-secondary'
                )}
              >
                {status === 'success' ? t('pay.done') : t('pay.tryAgain')}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
