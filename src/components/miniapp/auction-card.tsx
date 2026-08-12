'use client';

import Link from 'next/link';
import { Eye, Gavel, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/format';
import { Countdown } from './countdown';
import { useLanguage } from './language-provider';
import { FavoriteButton } from './favorite-button';
import type { PublicAuction } from '@/lib/miniapp-data';

function AuctionImage({ auction }: { auction: PublicAuction }) {
  if (!auction.imageUrl) {
    return (
      <div className="flex h-44 w-full items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Gavel className="h-10 w-10" />
      </div>
    );
  }
  return (
    // Plain <img>: item images come from arbitrary operator-supplied URLs, so
    // the Next image optimizer's host allow-list would reject most of them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={auction.imageUrl}
      alt={auction.title}
      loading="lazy"
      className="h-44 w-full rounded-xl object-contain"
    />
  );
}

export function AuctionCard({
  auction,
  favorited,
  highlight = false,
}: {
  auction: PublicAuction;
  favorited?: boolean;
  highlight?: boolean;
}) {
  const { t } = useLanguage();
  const isLive = auction.status === 'LIVE';

  return (
    <article
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:shadow-md',
        highlight && 'border-l-4 border-l-destructive'
      )}
    >
      <div className="relative p-3">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-md bg-destructive px-2 py-1 text-xs font-bold uppercase text-white shadow">
          {isLive ? (
            <>
              <span className="live-dot" />
              {t('auction.live')}
            </>
          ) : auction.status === 'SCHEDULED' ? (
            t('auction.scheduled')
          ) : (
            t('auction.ended')
          )}
        </div>

        {auction.viewCount !== null && (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1 text-sm font-bold text-accent">
            <Eye className="h-4 w-4" />
            {compactNumber(auction.viewCount)}
          </div>
        )}

        <Link href={`/auctions/${auction.code}`} aria-label={auction.title}>
          <AuctionImage auction={auction} />
        </Link>

        <div className="absolute bottom-5 right-5 z-10">
          <FavoriteButton auctionId={auction.id} initial={favorited} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <Link href={`/auctions/${auction.code}`}>
          <h3 className="line-clamp-2 text-lg font-bold leading-tight tracking-tight hover:text-primary">
            {auction.title}
          </h3>
        </Link>

        <div className="grid grid-cols-2 gap-2 border-y border-dashed border-border py-3">
          <div className="flex items-start gap-2">
            <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-medium text-primary">{t('auction.bidFee')}</p>
              <p className="text-sm font-bold">
                {auction.bidFee.toFixed(2)} {auction.currency === 'ETB' ? 'Br' : auction.currency}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 border-l border-dashed border-border pl-3">
            <Tag className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div>
              <p className="text-xs font-medium text-accent">{t('auction.code')}</p>
              <p className="text-sm font-bold">{auction.code}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Countdown endAt={auction.endAt} className="text-sm" />
          {auction.bidCount !== null && (
            <span className="text-sm font-bold text-primary">
              {compactNumber(auction.bidCount)}{' '}
              <span className="font-medium text-muted-foreground">{t('auction.bids')}</span>
            </span>
          )}
        </div>

        <Link
          href={`/auctions/${auction.code}`}
          className="howlow-cta mt-1 block rounded-xl px-4 py-3 text-center text-base font-bold text-white shadow-md transition active:scale-[0.99]"
        >
          {isLive ? t('auction.submitBid') : t('auction.viewDetails')}
        </Link>
      </div>
    </article>
  );
}
