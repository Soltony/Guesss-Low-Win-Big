'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ChevronUp, Flame, Package, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/format';
import { Countdown } from './countdown';
import { BidPanel } from './bid-panel';
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
 * the bid form opens in place, so a bid never needs the detail page.
 */
export function AuctionCard({
  auction,
  favorited,
  index = 0,
  connected = false,
  bidsUsed = 0,
}: {
  auction: PublicAuction;
  favorited?: boolean;
  /** Position in the list, used to stagger the entrance animation. */
  index?: number;
  /** A bidder session exists, so the inline form can be opened. */
  connected?: boolean;
  /** Bids this bidder already holds on this auction, for the remaining count. */
  bidsUsed?: number;
}) {
  const { t } = useLanguage();
  const [bidding, setBidding] = useState(false);
  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;
  const isLive = auction.status === 'LIVE';
  const endsWithin24h = new Date(auction.endAt).getTime() - Date.now() < 86_400_000;
  const panelId = `bid-panel-${auction.id}`;

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
            <StatusChip status={auction.status} urgent={isLive && endsWithin24h} />
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

        {/* The hook: what you could pay, against what it is worth. */}
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
          ) : connected ? (
            /* The bid form drops open right here — no page change, so the whole
               flow (amount, fee approval, confirmation) finishes on this list. */
            <button
              type="button"
              onClick={() => setBidding((open) => !open)}
              aria-expanded={bidding}
              aria-controls={panelId}
              className="gl-gold inline-flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-bold"
            >
              {t('auction.submitBid')}
              {bidding ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
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

      {isLive && connected && bidding && (
        <div id={panelId} className="gl-rise">
          <BidPanel
            auction={auction}
            connected={connected}
            bidsUsed={bidsUsed}
            variant="inline"
            onClose={() => setBidding(false)}
          />
        </div>
      )}
    </article>
  );
}
