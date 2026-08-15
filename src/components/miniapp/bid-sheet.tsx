'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Package, X } from 'lucide-react';
import { BidPanel } from './bid-panel';
import { Countdown } from './countdown';
import { useLanguage } from './language-provider';
import type { PublicAuction } from '@/lib/miniapp-data';

interface Props {
  auction: PublicAuction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connected: boolean;
  bidsUsed: number;
  /** Bids paid for in an earlier round that this bidder can still spend here. */
  carriedBids?: number;
  /** The re-auction rules exclude this bidder from the round. */
  blockedReason?: string | null;
}

/**
 * The bid form as a bottom sheet over a dimmed page.
 *
 * Expanding the form in place put the amount field wherever the card happened
 * to sit — usually below the fold, so placing a bid started with a scroll. A
 * sheet is anchored to the bottom of the viewport instead, which means the
 * field and the submit button land under the thumb no matter where the bidder
 * was on the list, and the dimmed backdrop makes the form the only thing on
 * screen worth reading.
 */
export function BidSheet({
  auction,
  open,
  onOpenChange,
  connected,
  bidsUsed,
  carriedBids = 0,
  blockedReason = null,
}: Props) {
  const { t } = useLanguage();
  // A fee approval is polled from inside the panel, so a stray tap on the
  // backdrop must not tear it down mid-payment. The X stays live throughout —
  // only accidental dismissal is blocked, never a deliberate exit.
  const [busy, setBusy] = useState(false);
  const thumbnail = auction.imageUrl ?? auction.images[0] ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-describedby={undefined}
          // Landing focus on the amount field would raise the keyboard over the
          // sheet before the bidder has seen what they are bidding on, so focus
          // goes to the sheet itself and the field is left for them to tap.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-[0_-16px_44px_-16px_hsl(224_47%_9%/0.45)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-200 data-[state=open]:duration-300"
        >
          {/* Grab handle: signals a sheet, and gives the header a top margin. */}
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />

          <div className="flex shrink-0 items-center gap-3 px-4 py-3">
            <div className="gl-media h-11 w-11 shrink-0">
              {thumbnail ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={thumbnail} alt="" className="h-full w-full object-contain p-1" />
              ) : (
                <Package className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.25} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <Dialog.Title className="line-clamp-1 text-sm font-bold leading-tight">
                {auction.title}
              </Dialog.Title>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono font-medium">#{auction.code}</span>
                {auction.status === 'LIVE' && (
                  <>
                    <span aria-hidden>·</span>
                    <Countdown endAt={auction.endAt} className="text-[11px] font-semibold" />
                  </>
                )}
              </p>
            </div>

            <Dialog.Close
              aria-label={t('common.close')}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* The panel can outgrow a short viewport once a note is showing, so
              it scrolls inside the sheet rather than pushing past the edge. The
              gutter is unconditional: Android webviews report a zero safe-area
              inset, which left the last line flush against the screen. */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <BidPanel
              auction={auction}
              connected={connected}
              bidsUsed={bidsUsed}
              carriedBids={carriedBids}
              blockedReason={blockedReason}
              variant="inline"
              onBusyChange={setBusy}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
