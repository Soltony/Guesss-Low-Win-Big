'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Crown, Flame, Lock, Package, ScrollText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/format';
import { Countdown } from './countdown';
import { BidSheet } from './bid-sheet';
import { BidLedgerSheet } from './bid-ledger-sheet';
import { useLanguage } from './language-provider';
import { FavoriteButton } from './favorite-button';
import type { PublicAuction } from '@/lib/miniapp-data';

function StatusChip({ status, urgent }: { status: string; urgent?: boolean }) {
  const { t } = useLanguage();

  if (status === 'LIVE') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm',
          urgent ? 'bg-accent text-accent-foreground' : 'bg-white/95 text-foreground'
        )}
      >
        {urgent ? <Flame className="h-3 w-3" /> : <span className="gl-live-dot" />}
        {urgent ? 'Ending soon' : t('auction.live')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground shadow-sm">
      {status === 'SCHEDULED' ? t('auction.scheduled') : t('auction.ended')}
    </span>
  );
}

/**
 * The workhorse of every list. Leads with the product and the value on offer,
 * because that is what makes someone tap; the mechanics sit underneath — and
 * the bid form opens in a sheet over the list, so a bid never needs the detail
 * page and never needs a scroll to reach the amount field.
 */
export function AuctionCard({
  auction,
  favorited,
  index = 0,
  connected = false,
  bidsUsed = 0,
  carriedBids = 0,
  blockedReason = null,
}: {
  auction: PublicAuction;
  favorited?: boolean;
  /** Position in the list, used to stagger the entrance animation. */
  index?: number;
  /** A bidder session exists, so the inline form can be opened. */
  connected?: boolean;
  /** Bids this bidder already holds on this auction, for the remaining count. */
  bidsUsed?: number;
  /** Bids paid for in an earlier round that this bidder can spend here free. */
  carriedBids?: number;
  /** Set when this bidder may not bid here — an invite-only auction they are
   *  not on the list for. The server rejects the bid either way; this is what
   *  stops the card offering a form that could only fail. */
  blockedReason?: string | null;
}) {
  const { t } = useLanguage();
  const [bidding, setBidding] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;
  const isLive = auction.status === 'LIVE';
  const endsWithin24h = new Date(auction.endAt).getTime() - Date.now() < 86_400_000;

  return (
    <article
      className="gl-card gl-card-interactive gl-rise overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 6) * 55}ms` }}
    >
      {/* Product */}
      <Link href={`/auctions/${auction.code}`} className="block" aria-label={auction.title}>
        <div className="gl-product h-64">
          {auction.imageUrl ? (
            /* Plain <img>: item photos come from arbitrary operator-supplied
               URLs, which the Next image optimizer's allow-list would reject. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={auction.imageUrl}
              alt={auction.title}
              loading="lazy"
              className="h-full w-full object-contain p-3 drop-shadow-[0_10px_18px_rgba(15,23,42,0.18)]"
            />
          ) : (
            <Package className="h-14 w-14 text-muted-foreground/60" strokeWidth={1.25} />
          )}

          <div className="absolute inset-x-3 top-3 flex items-start justify-between">
            <div className="flex flex-col items-start gap-1.5">
              <StatusChip status={auction.status} urgent={isLive && endsWithin24h} />
              {auction.restricted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-background backdrop-blur">
                  <Lock className="h-3 w-3" />
                  Invite only
                </span>
              )}
            </div>
            <span className="rounded-full bg-white/95 p-1.5 shadow-sm">
              <FavoriteButton auctionId={auction.id} initial={favorited} />
            </span>
          </div>
        </div>
      </Link>

      <div className="p-4">
        <Link href={`/auctions/${auction.code}`}>
          <h3 className="line-clamp-2 text-[17px] font-bold leading-snug tracking-tight">
            {auction.title}
          </h3>
        </Link>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono font-medium">#{auction.code}</span>
          {auction.reauctionRound > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-primary">
                Re-auction R{auction.reauctionRound}
              </span>
            </>
          )}
          {auction.categoryName && (
            <>
              <span aria-hidden>·</span>
              <span>{auction.categoryName}</span>
            </>
          )}
          {auction.bidCount !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {compactNumber(auction.bidCount)} {t('auction.bids')}
              </span>
            </>
          )}
        </p>

        {/* Once an auction is over, the entry price is no longer the story —
            the result is. The same slot carries whichever one is live. */}
        {auction.result ? (
          <div className="mt-3 flex items-end justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('auction.winner')}
              </p>
              <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                <Crown className="h-3.5 w-3.5 shrink-0 text-primary" />
                {auction.result.winnerName ?? 'A GuessLow bidder'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('auction.winningBid')}
              </p>
              <p className="text-2xl font-bold leading-none tracking-tight text-primary">
                {auction.result.amount.toFixed(2)}
                <span className="ml-1 text-sm font-semibold text-muted-foreground">{currency}</span>
              </p>
            </div>
          </div>
        ) : (
          /* The hook: what you could pay, against what it is worth. */
          <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-secondary/70 px-3 py-2.5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Bids start at
              </p>
              <p className="text-2xl font-bold leading-none tracking-tight">
                {auction.minBidAmount.toFixed(2)}
                <span className="ml-1 text-sm font-semibold text-muted-foreground">{currency}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('auction.bidFee')}
              </p>
              <p className="text-sm font-bold tabular-nums">
                {auction.bidFee.toFixed(2)} {currency}
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {isLive ? 'Closes in' : 'Closed'}
            </p>
            <Countdown endAt={auction.endAt} className="text-sm font-bold" />
          </div>

          {!isLive ? (
            <Link
              href={`/auctions/${auction.code}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-secondary"
            >
              {t('auction.viewDetails')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : connected && blockedReason ? (
            <Link
              href={`/auctions/${auction.code}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-5 py-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Lock className="h-4 w-4" />
              Not open to you
            </Link>
          ) : connected ? (
            /* The bid form opens in a sheet over the list — no page change, so
               the whole flow (amount, fee approval, confirmation) finishes
               here, in front of whatever the bidder was looking at. */
            <button
              type="button"
              onClick={() => setBidding(true)}
              aria-haspopup="dialog"
              aria-expanded={bidding}
              className="gl-gold inline-flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-bold"
            >
              {t('auction.submitBid')}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <Link
              href="/connect"
              className="gl-gold inline-flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-bold"
            >
              Connect to bid
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Anyone can read the record of a finished auction, whether or not they
          bid in it — that is the point of publishing it. The sheet fetches its
          own summary when opened, so a list of these costs nothing to render. */}
      {auction.ledgerPublished && (
        <>
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={ledgerOpen}
            className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-3 text-left text-xs font-bold transition-colors hover:bg-secondary"
          >
            <span className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              {t('ledger.open')}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          <BidLedgerSheet
            auctionCode={auction.code}
            currency={currency}
            winnerName={auction.result?.winnerName ?? null}
            connected={connected}
            open={ledgerOpen}
            onOpenChange={setLedgerOpen}
          />
        </>
      )}

      {isLive && connected && !blockedReason && (
        <BidSheet
          auction={auction}
          open={bidding}
          onOpenChange={setBidding}
          connected={connected}
          bidsUsed={bidsUsed}
          carriedBids={carriedBids}
        />
      )}
    </article>
  );
}
