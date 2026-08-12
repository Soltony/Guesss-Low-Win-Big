'use client';

import Link from 'next/link';
import { Gavel, Package, Sparkles, Timer, Trophy } from 'lucide-react';
import { useLanguage } from './language-provider';
import { AuctionCard } from './auction-card';
import { EmptyState, SectionHeading } from './section-heading';
import { compactNumber } from '@/lib/format';
import type { PublicAuction } from '@/lib/miniapp-data';

interface HomeCategory {
  id: string;
  name: string;
  nameAm: string | null;
  slug: string;
  imageUrl: string | null;
}

interface RecentWinner {
  id: string;
  title: string;
  code: string;
  amount: number;
  currency: string;
  imageUrl: string | null;
  winner: string;
  settledAt: string;
}

export function HomeView({
  tagline,
  categories,
  featured,
  endingSoon,
  recentWinners,
  favorites,
  stats,
}: {
  tagline: string;
  categories: HomeCategory[];
  featured: PublicAuction[];
  endingSoon: PublicAuction[];
  recentWinners: RecentWinner[];
  favorites: string[];
  stats: { liveAuctions: number; totalBids: number; totalWinners: number };
}) {
  const { t, lang } = useLanguage();
  const favoriteSet = new Set(favorites);

  return (
    <div className="pb-6">
      {/* Hero */}
      <section className="howlow-hero px-4 pb-10 pt-6 text-white">
        <span className="howlow-cta inline-block rounded-lg px-4 py-2 text-lg font-bold shadow-md">
          {t('app.platform')}
        </span>
        <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight">
          {tagline || t('app.tagline')}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-white/95">{t('home.description')}</p>

        <Link
          href="/auctions"
          className="howlow-cta mt-6 inline-block rounded-xl border-b-4 border-sky-700/60 px-8 py-4 text-base font-bold uppercase tracking-wide text-white shadow-lg transition active:translate-y-0.5 active:border-b-2"
        >
          {t('home.startBidding')}
        </Link>

        <dl className="mt-7 grid grid-cols-3 gap-3">
          {[
            { label: t('auction.live'), value: stats.liveAuctions, icon: Gavel },
            { label: t('auction.bids'), value: stats.totalBids, icon: Sparkles },
            { label: t('auction.winner'), value: stats.totalWinners, icon: Trophy },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl bg-white/15 px-3 py-3 text-center backdrop-blur-sm"
            >
              <Icon className="mx-auto h-4 w-4 opacity-90" />
              <dd className="mt-1 text-xl font-bold tabular-nums">{compactNumber(value)}</dd>
              <dt className="text-[11px] uppercase tracking-wide opacity-90">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="px-4 pt-6">
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/auctions?category=${category.id}`}
                className="flex w-40 shrink-0 snap-start flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md"
              >
                {category.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={category.imageUrl}
                    alt=""
                    className="h-16 w-16 object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Package className="h-16 w-16 text-primary/70" strokeWidth={1.25} />
                )}
                <span className="text-center text-sm font-bold uppercase tracking-wide">
                  {lang === 'am' && category.nameAm ? category.nameAm : category.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Featured */}
      <section>
        <SectionHeading title={t('home.featured')} subtitle={t('home.featuredSub')} />
        <div className="space-y-4 px-4">
          {featured.length === 0 ? (
            <EmptyState
              icon={Gavel}
              title={t('common.empty')}
              description="Featured auctions will appear here once they go live."
            />
          ) : (
            featured.map((auction) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                favorited={favoriteSet.has(auction.id)}
              />
            ))
          )}
        </div>
      </section>

      {/* Ending soon */}
      {endingSoon.length > 0 && (
        <section className="mt-4 bg-secondary/40 pb-6">
          <SectionHeading title={t('home.endingSoon')} subtitle={t('home.endingSoonSub')} />
          <div className="space-y-4 px-4">
            {endingSoon.map((auction) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                favorited={favoriteSet.has(auction.id)}
                highlight
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent winners */}
      {recentWinners.length > 0 && (
        <section className="pb-4">
          <SectionHeading title={t('auction.winner')} />
          <ul className="space-y-2 px-4">
            {recentWinners.map((win) => (
              <li
                key={win.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {win.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={win.imageUrl}
                    alt=""
                    className="h-12 w-12 rounded-lg object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
                    <Trophy className="h-5 w-5 text-accent" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{win.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {win.winner} · #{win.code}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t('auction.winningBid')}</p>
                  <p className="font-bold text-primary">
                    {win.amount.toFixed(2)} {win.currency === 'ETB' ? 'Br' : win.currency}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* How it works */}
      <section className="px-4 pb-6">
        <SectionHeading title={t('home.howItWorks')} />
        <ol className="space-y-3">
          {[
            {
              icon: Gavel,
              title: 'Pick an auction',
              body: 'Choose any live item. Each auction shows its service fee and auction code.',
            },
            {
              icon: Sparkles,
              title: 'Guess low and unique',
              body: 'Submit an amount no one else has picked. You can submit many different amounts.',
            },
            {
              icon: Timer,
              title: 'Wait for the close',
              body: 'Bid statuses stay hidden while the auction runs, so nobody can map the bids.',
            },
            {
              icon: Trophy,
              title: 'Lowest unique wins',
              body: 'When the timer hits zero, the lowest amount held by exactly one bidder wins.',
            },
          ].map((step, index) => (
            <li
              key={step.title}
              className="flex gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                {index + 1}
              </div>
              <div>
                <p className="font-semibold">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
