'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Flame,
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
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-bold tabular-nums">{value}</dd>
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
  const endsWithin24h = new Date(auction.endAt).getTime() - Date.now() < 86_400_000;

  return (
    <div className="pb-10">
      {/* ---------- Dark header: back bar, gallery, title ---------- */}
      <section className="gl-ink gl-spotlight relative overflow-hidden pb-8">
        <div className="gl-dots pointer-events-none absolute inset-0 opacity-60" />

        <div className="relative flex items-center gap-1 px-2 py-2">
          <Link
            href="/auctions"
            aria-label="Back to auctions"
            className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="line-clamp-1 flex-1 text-sm font-medium text-white/80">
            {auction.title}
          </span>
          <span className="rounded-full bg-white/10 p-2">
            <FavoriteButton auctionId={auction.id} initial={favorited} onDark />
          </span>
        </div>

        {/* Gallery on a light plate, so the product reads clearly against the ink */}
        <div className="relative px-4 pt-2">
          <div className="gl-product aspect-[4/3] w-full rounded-2xl">
            {images.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[activeImage]}
                alt={auction.title}
                className="h-full w-full object-contain p-6 drop-shadow-[0_16px_28px_rgba(15,23,42,0.22)]"
              />
            ) : (
              <Package className="h-14 w-14 text-muted-foreground/60" strokeWidth={1.25} />
            )}

            <div className="absolute inset-x-3 top-3 flex items-start justify-between">
              {isLive ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm',
                    endsWithin24h
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-white/95 text-foreground'
                  )}
                >
                  {endsWithin24h ? <Flame className="h-3 w-3" /> : <span className="gl-live-dot" />}
                  {endsWithin24h ? 'Ending soon' : t('auction.live')}
                </span>
              ) : (
                <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground shadow-sm">
                  {auction.status === 'SCHEDULED' ? t('auction.scheduled') : t('auction.ended')}
                </span>
              )}

              {auction.viewCount !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/80 px-2.5 py-1 text-[11px] font-semibold text-background backdrop-blur">
                  <Eye className="h-3 w-3" />
                  {compactNumber(auction.viewCount)}
                </span>
              )}
            </div>
          </div>

          {images.length > 1 && (
            <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-current={index === activeImage}
                  className={cn(
                    'gl-media h-14 w-14 shrink-0 border-2 transition-colors',
                    index === activeImage ? 'border-primary' : 'border-transparent opacity-60'
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-full w-full object-contain p-1" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
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
                  <span>
                    {compactNumber(auction.bidCount)} {t('auction.bids')}
                  </span>
                </>
              )}
            </div>

            <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
              {auction.title}
            </h1>
            {auction.subtitle && (
              <p className="mt-1.5 text-sm text-white/65">{auction.subtitle}</p>
            )}

            {auction.retailPrice > 0 && (
              <p className="mt-3 flex items-baseline gap-2 text-sm">
                <span className="text-white/55">{t('auction.retailPrice')}</span>
                <span className="gl-was font-semibold text-white/80">
                  {auction.retailPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                  {currency}
                </span>
              </p>
            )}

            {isLive && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
                  Closes in
                </p>
                <Countdown endAt={auction.endAt} variant="blocks" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Facts ---------- */}
      <section className="px-4 pt-5">
        {/* gap-px over a border-coloured backdrop gives clean hairlines in both
            directions without divide-x/y edge cases at the row breaks. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          <Fact label={t('auction.bidFee')} value={`${auction.bidFee.toFixed(2)} ${currency}`} />
          <Fact
            label={t('auction.range')}
            value={`${auction.minBidAmount.toFixed(2)} – ${auction.maxBidAmount.toFixed(2)}`}
          />
          <Fact label="Bid increment" value={auction.bidStep.toFixed(2)} />
          <Fact label="Max bids per person" value={auction.maxBidsPerUser} />
        </dl>
      </section>

      {/* ---------- Result or bidding ---------- */}
      <section className="px-4 pt-4">
        {auction.settled ? (
          <div className="gl-card overflow-hidden">
            <div className="gl-ink gl-spotlight relative px-4 py-3">
              <p className="relative flex items-center gap-2 text-sm font-bold">
                <Trophy className="h-4 w-4 text-primary" />
                {auction.winner ? t('auction.winner') : t('auction.noWinner')}
              </p>
            </div>
            {auction.winner && (
              <div className="flex items-end justify-between gap-3 p-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Taken by
                  </p>
                  <p className="text-sm font-semibold">{auction.winner.displayName}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('auction.winningBid')}
                  </p>
                  <p className="text-2xl font-bold leading-none tabular-nums text-primary">
                    {auction.winner.amount.toFixed(2)}
                    <span className="ml-1 text-sm font-semibold text-muted-foreground">
                      {currency}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : !connected ? (
          <Link
            href="/connect"
            className="gl-gold flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-sm font-bold"
          >
            Connect to bid
          </Link>
        ) : (
          <BidPanel auction={auction} connected={connected} bidsUsed={myBids.length} />
        )}
      </section>

      {/* ---------- My bids ---------- */}
      <section className="px-4 pt-7">
        <div className="gl-section-rule mb-3">
          <h2 className="text-base font-bold tracking-tight">
            {t('auction.yourBids')}{' '}
            <span className="font-medium text-muted-foreground">
              {myBids.length}/{auction.maxBidsPerUser}
            </span>
          </h2>
        </div>

        {!revealAllowed && myBids.length > 0 && (
          <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {t('bid.hiddenUntilEnd')}
          </p>
        )}

        {myBids.length === 0 ? (
          <p className="gl-panel px-4 py-7 text-center text-xs text-muted-foreground">
            {t('auction.noBidsYet')}
          </p>
        ) : (
          <ul className="gl-panel divide-y divide-border">
            {myBids.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-base font-bold tabular-nums">
                    {bid.amount.toFixed(2)}{' '}
                    <span className="text-xs font-medium text-muted-foreground">{currency}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    #{bid.sequence} · {new Date(bid.createdAt).toLocaleString('en-GB')}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {revealAllowed && bid.isUnique !== null && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-bold',
                        bid.isUnique
                          ? 'bg-primary/15 text-foreground'
                          : 'bg-secondary text-muted-foreground'
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

      {/* ---------- Description ---------- */}
      {auction.description && (
        <section className="px-4 pt-7">
          <div className="gl-section-rule mb-3">
            <h2 className="text-base font-bold tracking-tight">About this item</h2>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {auction.description}
          </p>
        </section>
      )}

      {/* ---------- Rules and terms ---------- */}
      <section className="space-y-2 px-4 pt-7">
        <details className="gl-panel group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
            {t('home.howItWorks')}
            <span className="text-muted-foreground transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('home.description')}
          </p>
        </details>

        {auction.terms && (
          <details className="gl-panel group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
              <span className="min-w-0 truncate">{auction.terms.title}</span>
              <span className="text-muted-foreground transition-transform group-open:rotate-180">
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
