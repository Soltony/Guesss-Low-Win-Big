'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from './language-provider';

/**
 * `waiting` covers the whole hand-off: the token going out over the super
 * app's JS channel, the PIN sheet, and the gateway's callback reaching us. A
 * failure the gateway reports is *also* shown as `waiting` for a grace period
 * before it resolves to `failed` — see `bid-panel`.
 */
export type PaymentStatus = 'waiting' | 'success' | 'failed';

interface Props {
  open: boolean;
  status: PaymentStatus;
  /** The bid being paid for, echoed back so the screen names what is at stake. */
  amount: number | null;
  fee: number;
  currency: string;
  /** Auction title, for the line inside the summary card. */
  auctionTitle: string;
  /** Why the payment failed, when the panel has a reason from the gateway. */
  message: string | null;
  /** Only reachable once the payment has settled either way. */
  onDone: () => void;
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
  message,
  onDone,
}: Props) {
  const { t } = useLanguage();
  const settled = status !== 'waiting';

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
          <div className="flex w-full max-w-sm flex-col items-center text-center">
            {/* ---------- The badge ---------- */}
            <div
              className={cn(
                'flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2',
                status === 'waiting' && 'border-accent/30 bg-accent/10',
                status === 'success' && 'border-success/30 bg-success/10',
                status === 'failed' && 'border-destructive/30 bg-destructive/10'
              )}
            >
              {status === 'waiting' && (
                <Loader2 className="h-11 w-11 animate-spin text-accent" strokeWidth={2} />
              )}
              {status === 'success' && (
                <CheckCircle2 className="h-12 w-12 text-success" strokeWidth={2} />
              )}
              {status === 'failed' && (
                <XCircle className="h-12 w-12 text-destructive" strokeWidth={2} />
              )}
            </div>

            {/* ---------- The verdict ----------
                Announced rather than merely drawn: the bidder may well be
                looking at the wallet's own sheet when this flips. */}
            <div aria-live="polite" className="w-full">
              <Dialog.Title
                className={cn(
                  'mt-6 text-xl font-extrabold leading-tight',
                  status === 'success' && 'text-success',
                  status === 'failed' && 'text-destructive'
                )}
              >
                {status === 'waiting' && t('bid.confirming')}
                {status === 'success' && t('bid.confirmed')}
                {status === 'failed' && t('bid.failed')}
              </Dialog.Title>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {status === 'waiting' &&
                  t('pay.approveHint', { fee: `${fee.toFixed(2)} ${currency}` })}
                {status === 'success' && t('bid.hiddenUntilEnd')}
                {status === 'failed' && (message || t('pay.failedFallback'))}
              </p>
            </div>

            {/* ---------- What is being paid for ---------- */}
            <div className="mt-7 w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-left">
              <p className="line-clamp-2 text-[13px] font-bold leading-snug">{auctionTitle}</p>

              <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {status === 'success' ? t('bid.registered') : t('auction.bidAmount')}
                </span>
                <span className="text-lg font-extrabold leading-none tabular-nums">
                  {amount !== null ? amount.toFixed(2) : '—'}
                  <span className="ml-1 text-[11px] font-semibold text-muted-foreground">
                    {currency}
                  </span>
                </span>
              </div>

              <div className="mt-2.5 flex items-end justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('pay.serviceFee')}
                </span>
                <span className="text-sm font-bold leading-none tabular-nums text-muted-foreground">
                  {fee.toFixed(2)}
                  <span className="ml-1 text-[11px] font-semibold">{currency}</span>
                </span>
              </div>
            </div>

            {/* ---------- The way out ---------- */}
            {status === 'waiting' ? (
              <p className="mt-7 flex items-start gap-2 text-left text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {t('pay.keepOpen')}
              </p>
            ) : (
              <button
                type="button"
                onClick={onDone}
                autoFocus
                className={cn(
                  'mt-7 w-full rounded-xl px-4 py-3.5 text-base font-bold transition-colors',
                  status === 'success'
                    ? 'gl-gold'
                    : 'border border-border bg-secondary text-foreground hover:bg-secondary/70'
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
