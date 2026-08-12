'use client';

import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/format';
import { Countdown } from './countdown';
import { useLanguage } from './language-provider';
import { FavoriteButton } from './favorite-button';
import type { PublicAuction } from '@/lib/miniapp-data';

function Thumb({ auction, size }: { auction: PublicAuction; size: string }) {
  if (!auction.imageUrl) {
    return (
      <div className={cn('gl-media shrink-0', size)}>
        <Package className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <div className={cn('gl-media shrink-0', size)}>
      {/* Plain <img>: item photos come from arbitrary operator-supplied URLs,
          which the Next image optimizer's host allow-list would reject. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={auction.imageUrl}
        alt={auction.title}
        loading="lazy"
        className="h-full w-full object-contain p-2"
      />
    </div>
  );
}

function StatusMark({ status }: { status: string }) {
  const { t } = useLanguage();

  if (status === 'LIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
        <span className="gl-live-dot" />
        {t('auction.live')}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {status === 'SCHEDULED' ? t('auction.scheduled') : t('auction.ended')}
    </span>
  );
}

/** Compact row used in every auction list. */
export function AuctionCard({
  auction,
  favorited,
}: {
  auction: PublicAuction;
  favorited?: boolean;
}) {
  const { t } = useLanguage();
  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;

  return (
    <article className="gl-panel group relative p-3 transition-colors hover:border-foreground/20">
      <div className="flex gap-3">
        <Link href={`/auctions/${auction.code}`} aria-label={auction.title}>
          <Thumb auction={auction} size="h-24 w-24" />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <StatusMark status={auction.status} />
            <FavoriteButton auctionId={auction.id} initial={favorited} />
          </div>

          <Link href={`/auctions/${auction.code}`} className="mt-1">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight group-hover:underline">
              {auction.title}
            </h3>
          </Link>

          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono">#{auction.code}</span>
            {auction.categoryName && <> · {auction.categoryName}</>}
            {auction.bidCount !== null && (
              <>
                {' '}
                · {compactNumber(auction.bidCount)} {t('auction.bids')}
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('auction.bidFee')}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {auction.bidFee.toFixed(2)} {currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('auction.range')}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {auction.minBidAmount.toFixed(2)}–{auction.maxBidAmount.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {auction.status === 'LIVE' ? 'Ends in' : 'Ends'}
          </dt>
          <dd className="mt-0.5">
            <Countdown endAt={auction.endAt} className="text-xs font-semibold" />
          </dd>
        </div>
      </dl>

      <Link
        href={`/auctions/${auction.code}`}
        className={cn(
          'mt-3 flex w-full items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors',
          auction.status === 'LIVE'
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border border-border text-foreground hover:bg-secondary'
        )}
      >
        {auction.status === 'LIVE' ? t('auction.submitBid') : t('auction.viewDetails')}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </article>
  );
}
