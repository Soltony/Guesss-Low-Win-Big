'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  Gavel,
  Info,
  Loader2,
  Lock,
  Tag,
  Trophy,
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
  const images = auction.images.length > 0 ? auction.images : [];

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-3">
        <Link
          href="/auctions"
          aria-label="Back to auctions"
          className="rounded-full p-2 transition hover:bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="line-clamp-1 flex-1 font-bold">{auction.title}</h1>
        <FavoriteButton auctionId={auction.id} initial={favorited} />
      </div>

      {/* Gallery */}
      <div className="relative bg-card px-4 pt-4">
        <div className="absolute left-6 top-6 z-10 flex items-center gap-1.5 rounded-md bg-destructive px-2 py-1 text-xs font-bold uppercase text-white shadow">
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
          <div className="absolute right-6 top-6 z-10 flex items-center gap-1 text-sm font-bold text-accent">
            <Eye className="h-4 w-4" />
            {compactNumber(auction.viewCount)}
          </div>
        )}

        {images.length > 0 ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[activeImage]}
              alt={auction.title}
              className="h-64 w-full rounded-xl object-contain"
            />
            {images.length > 1 && (
              <div className="mt-3 flex justify-center gap-2">
                {images.map((image, index) => (
                  <button
                    key={image}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`View image ${index + 1}`}
                    className={cn(
                      'h-14 w-14 overflow-hidden rounded-lg border-2 bg-secondary transition',
                      index === activeImage ? 'border-primary' : 'border-transparent opacity-70'
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-64 w-full items-center justify-center rounded-xl bg-secondary">
            <Gavel className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Facts */}
      <div className="space-y-4 bg-card px-4 pb-5 pt-4">
        <h2 className="text-2xl font-bold leading-tight tracking-tight">{auction.title}</h2>
        {auction.subtitle && <p className="text-sm text-muted-foreground">{auction.subtitle}</p>}

        <div className="grid grid-cols-2 gap-3 border-y border-dashed border-border py-3">
          <div className="flex items-start gap-2">
            <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-medium text-primary">{t('auction.bidFee')}</p>
              <p className="font-bold">
                {auction.bidFee.toFixed(2)} {currency}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 border-l border-dashed border-border pl-3">
            <Tag className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div>
              <p className="text-xs font-medium text-accent">{t('auction.code')}</p>
              <p className="font-bold">{auction.code}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Countdown endAt={auction.endAt} />
          </div>
          {auction.bidCount !== null && (
            <span className="font-bold text-primary">
              {compactNumber(auction.bidCount)}{' '}
              <span className="font-medium text-muted-foreground">{t('auction.bids')}</span>
            </span>
          )}
        </div>

        {auction.retailPrice > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('auction.retailPrice')}:{' '}
            <span className="font-semibold text-foreground line-through decoration-destructive/60">
              {auction.retailPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}
            </span>
          </p>
        )}

        {/* Bidding */}
        {auction.settled ? (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center gap-2 font-bold text-primary">
              <Trophy className="h-5 w-5" />
              {auction.winner ? t('auction.winner') : t('auction.noWinner')}
            </div>
            {auction.winner && (
              <div className="mt-2 space-y-1 text-sm">
                <p className="font-semibold">{auction.winner.displayName}</p>
                <p className="text-muted-foreground">
                  {t('auction.winningBid')}:{' '}
                  <span className="font-bold text-foreground">
                    {auction.winner.amount.toFixed(2)} {currency}
                  </span>
                </p>
              </div>
            )}
          </div>
        ) : !connected ? (
          <a
            href="/connect"
            className="howlow-cta block rounded-xl px-4 py-4 text-center text-base font-bold text-white shadow-md"
          >
            Connect to bid
          </a>
        ) : (
          <BidPanel auction={auction} connected={connected} bidsUsed={myBids.length} />
        )}
      </div>

      {/* My bids */}
      <section className="mt-4 px-4">
        <h3 className="mb-2 flex items-center gap-2 font-bold">
          <Gavel className="h-4 w-4 text-primary" />
          {t('auction.yourBids')} ({myBids.length}/{auction.maxBidsPerUser})
        </h3>

        {!revealAllowed && myBids.length > 0 && (
          <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {t('bid.hiddenUntilEnd')}
          </p>
        )}

        {myBids.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
            {t('auction.noBidsYet')}
          </p>
        ) : (
          <ul className="space-y-2">
            {myBids.map((bid) => (
              <li
                key={bid.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <div>
                  <p className="text-lg font-bold tabular-nums">
                    {bid.amount.toFixed(2)}{' '}
                    <span className="text-sm font-medium text-muted-foreground">{currency}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    #{bid.sequence} · {new Date(bid.createdAt).toLocaleString('en-GB')}
                  </p>
                </div>

                <div className="text-right">
                  {bid.status === 'PENDING_PAYMENT' ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-warning">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('bid.pending')}
                    </span>
                  ) : bid.status === 'ACTIVE' ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('bid.confirmed')}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground">
                      {bid.status === 'FAILED' ? t('bid.failed') : t('bid.void')}
                    </span>
                  )}

                  {revealAllowed && bid.isUnique !== null && (
                    <p
                      className={cn(
                        'mt-1 text-xs font-bold',
                        bid.isUnique ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {bid.isUnique ? t('bid.unique') : t('bid.taken')}
                      {bid.rank ? ` · #${bid.rank}` : ''}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Description */}
      {auction.description && (
        <section className="mt-4 px-4">
          <h3 className="mb-2 font-bold">About this item</h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {auction.description}
          </p>
        </section>
      )}

      {/* Rules */}
      <section className="mt-4 px-4">
        <div className="flex gap-2 rounded-xl border border-border bg-card p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{t('home.howItWorks')}</p>
            <p className="mt-1">{t('home.description')}</p>
          </div>
        </div>
      </section>

      {/* Terms */}
      {auction.terms && (
        <section className="mt-4 px-4">
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              {auction.terms.title}
            </summary>
            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {lang === 'am' && auction.terms.contentAm
                ? auction.terms.contentAm
                : auction.terms.contentEn}
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
