'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Loader2,
  Lock,
  Package,
  Trophy,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/format';
import { Countdown } from './countdown';
import { BidPanel } from './bid-panel';
import { FavoriteButton } from './favorite-button';
import { useLanguage } from './language-provider';
import type { PublicAuction } from '@/lib/miniapp-data';

interface MyBid {
  id: string;
  amount: number;
  feeAmount: number;
  status: string;
  sequence: number;
  createdAt: string;
  isUnique: boolean | null;
  rank: number | null;
}

interface DetailAuction extends PublicAuction {
  terms?: { title: string; contentEn: string; contentAm: string | null } | null;
  winner?: { amount: number; status: string; displayName: string } | null;
  settled?: boolean;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function AuctionDetail({
  auction,
  connected,
  myBids,
  favorited,
  revealAllowed,
}: {
  auction: DetailAuction;
  connected: boolean;
  myBids: MyBid[];
  favorited: boolean;
  revealAllowed: boolean;
}) {
  const { t, lang } = useLanguage();
  const [activeImage, setActiveImage] = useState(0);
  const currency = auction.currency === 'ETB' ? 'Br' : auction.currency;
  const isLive = auction.status === 'LIVE';
  const images = auction.images;

  return (
    <div className="pb-8">
      {/* Back bar */}
      <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-2">
        <Link
          href="/auctions"
          aria-label="Back to auctions"
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="line-clamp-1 flex-1 text-sm font-medium">{auction.title}</span>
        <div className="px-2">
          <FavoriteButton auctionId={auction.id} initial={favorited} />
        </div>
      </div>

      {/* Gallery */}
      <section className="bg-card px-4 pb-5 pt-4">
        <div className="gl-media aspect-[4/3] w-full">
          {images.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[activeImage]}
              alt={auction.title}
              className="h-full w-full object-contain p-4"
            />
          ) : (
            <Package className="h-10 w-10 text-muted-foreground" strokeWidth={1.25} />
          )}
        </div>

        {images.length > 1 && (
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                onClick={() => setActiveImage(index)}
                aria-label={`View image ${index + 1}`}
                aria-current={index === activeImage}
                className={cn(
                  'gl-media h-14 w-14 shrink-0 border transition-colors',
                  index === activeImage ? 'border-foreground' : 'border-transparent'
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="h-full w-full object-contain p-1" />
              </button>
            ))}
          </div>
        )}

        {/* Title block */}
        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isLive ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                  <span className="gl-live-dot" />
                  {t('auction.live')}
                </span>
              ) : (
                <span className="font-medium text-muted-foreground">
                  {auction.status === 'SCHEDULED' ? t('auction.scheduled') : t('auction.ended')}
                </span>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-muted-foreground">#{auction.code}</span>
              {auction.categoryName && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{auction.categoryName}</span>
                </>
              )}
            </div>

            <h1 className="mt-2 text-xl font-semibold leading-snug tracking-tight">
              {auction.title}
            </h1>
            {auction.subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{auction.subtitle}</p>
            )}
          </div>

          {auction.viewCount !== null && (
            <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              {compactNumber(auction.viewCount)}
            </span>
          )}
        </div>
      </section>

      {/* Countdown */}
      {isLive && (
        <section className="px-4 pt-4">
          <div className="gl-panel px-4 py-3">
            <p className="text-xs text-muted-foreground">Closes in</p>
            <div className="mt-2">
              <Countdown endAt={auction.endAt} variant="blocks" />
            </div>
          </div>
        </section>
      )}

      {/* Facts */}
      <section className="px-4 pt-4">
        {/* gap-px over a border-coloured backdrop gives clean hairlines in both
            directions without divide-x/y edge cases at the row breaks. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <Fact
            label={t('auction.bidFee')}
            value={`${auction.bidFee.toFixed(2)} ${currency}`}
          />
          <Fact
            label={t('auction.range')}
            value={`${auction.minBidAmount.toFixed(2)} – ${auction.maxBidAmount.toFixed(2)}`}
          />
          <Fact
            label={t('auction.retailPrice')}
            value={
              auction.retailPrice > 0
                ? `${auction.retailPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })} ${currency}`
                : '—'
            }
          />
          <Fact
            label={t('auction.bids')}
            value={auction.bidCount !== null ? compactNumber(auction.bidCount) : '—'}
          />
        </dl>
      </section>

      {/* Result or bidding */}
      <section className="px-4 pt-4">
        {auction.settled ? (
          <div className="gl-panel p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-primary" />
              {auction.winner ? t('auction.winner') : t('auction.noWinner')}
            </p>
            {auction.winner && (
              <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t('auction.winner')}</p>
                  <p className="text-sm font-medium">{auction.winner.displayName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t('auction.winningBid')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {auction.winner.amount.toFixed(2)} {currency}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : !connected ? (
          <Link
            href="/connect"
            className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Connect to bid
          </Link>
        ) : (
          <BidPanel auction={auction} connected={connected} bidsUsed={myBids.length} />
        )}
      </section>

      {/* My bids */}
      <section className="px-4 pt-6">
        <div className="gl-section-rule mb-3">
          <h2 className="text-sm font-semibold">
            {t('auction.yourBids')}{' '}
            <span className="font-normal text-muted-foreground">
              {myBids.length}/{auction.maxBidsPerUser}
            </span>
          </h2>
        </div>

        {!revealAllowed && myBids.length > 0 && (
          <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {t('bid.hiddenUntilEnd')}
          </p>
        )}

        {myBids.length === 0 ? (
          <p className="gl-panel px-4 py-6 text-center text-xs text-muted-foreground">
            {t('auction.noBidsYet')}
          </p>
        ) : (
          <ul className="gl-panel divide-y divide-border">
            {myBids.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums">
                    {bid.amount.toFixed(2)}{' '}
                    <span className="text-xs font-normal text-muted-foreground">{currency}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    #{bid.sequence} · {new Date(bid.createdAt).toLocaleString('en-GB')}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {revealAllowed && bid.isUnique !== null && (
                    <span
                      className={cn(
                        'text-xs font-medium',
                        bid.isUnique ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {bid.isUnique ? t('bid.unique') : t('bid.taken')}
                      {bid.rank ? ` · #${bid.rank}` : ''}
                    </span>
                  )}
                  {bid.status === 'PENDING_PAYMENT' ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('bid.pending')}
                    </span>
                  ) : bid.status === 'ACTIVE' ? (
                    <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('bid.confirmed')} />
                  ) : (
                    <XCircle
                      className="h-4 w-4 text-muted-foreground"
                      aria-label={bid.status === 'FAILED' ? t('bid.failed') : t('bid.void')}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Description */}
      {auction.description && (
        <section className="px-4 pt-6">
          <div className="gl-section-rule mb-3">
            <h2 className="text-sm font-semibold">About this item</h2>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {auction.description}
          </p>
        </section>
      )}

      {/* Rules and terms */}
      <section className="space-y-2 px-4 pt-6">
        <details className="gl-panel group px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium">
            {t('home.howItWorks')}
            <span className="float-right text-muted-foreground transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('home.description')}
          </p>
        </details>

        {auction.terms && (
          <details className="gl-panel group px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium">
              {auction.terms.title}
              <span className="float-right text-muted-foreground transition-transform group-open:rotate-180">
                ⌄
              </span>
            </summary>
            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {lang === 'am' && auction.terms.contentAm
                ? auction.terms.contentAm
                : auction.terms.contentEn}
            </p>
          </details>
        )}
      </section>
    </div>
  );
}
