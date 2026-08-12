'use client';

import Link from 'next/link';
import { ArrowRight, Gavel, Package, Timer, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
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

const STEPS = [
  {
    title: 'Pick an auction',
    body: 'Every item shows its service fee and auction code up front.',
  },
  {
    title: 'Guess low and unique',
    body: 'Submit an amount nobody else has picked. Many amounts allowed.',
  },
  {
    title: 'Stay hidden',
    body: 'Bid statuses are sealed while the auction runs, so nothing leaks.',
  },
  {
    title: 'Lowest unique wins',
    body: 'At zero, the lowest amount held by exactly one bidder takes it.',
  },
];

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
    <div className="pb-8">
      {/* Hero — typographic, on the page canvas rather than a coloured band */}
      <section className="px-4 pb-6 pt-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('app.platform')}
        </p>
        <h1 className="mt-2 text-[32px] font-semibold leading-[1.1] tracking-tight">
          {tagline || t('app.tagline')}
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t('home.description')}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/auctions"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('home.startBidding')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="#how-it-works"
            className="inline-flex items-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
          >
            {t('home.howItWorks')}
          </Link>
        </div>
      </section>

      {/* Stats — one panel, hairline dividers, no colour blocks */}
      <section className="px-4">
        <dl className="gl-panel grid grid-cols-3 divide-x divide-border">
          {[
            { label: t('auction.live'), value: stats.liveAuctions, icon: Gavel },
            { label: t('auction.bids'), value: stats.totalBids, icon: Timer },
            { label: t('auction.winner'), value: stats.totalWinners, icon: Trophy },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="px-3 py-3 text-center">
              <Icon className="mx-auto h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              <dd className="mt-1.5 text-xl font-semibold tabular-nums leading-none">
                {compactNumber(value)}
              </dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* Categories — quiet chips, not oversized tiles */}
      {categories.length > 0 && (
        <section className="pt-7">
          <SectionHeading title={t('home.categories')} href="/auctions" hrefLabel="Browse" />
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/auctions?category=${category.id}`}
                className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-card py-2 pl-2 pr-3.5 transition-colors hover:bg-secondary"
              >
                {category.imageUrl ? (
                  <span className="gl-media h-8 w-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={category.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  </span>
                ) : (
                  <span className="gl-media h-8 w-8">
                    <Package className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  </span>
                )}
                <span className="whitespace-nowrap text-sm font-medium">
                  {lang === 'am' && category.nameAm ? category.nameAm : category.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Featured */}
      <section className="pt-7">
        <SectionHeading
          title={t('home.featured')}
          subtitle={t('home.featuredSub')}
          href="/auctions"
        />
        <div className="space-y-3 px-4">
          {featured.length === 0 ? (
            <EmptyState
              icon={Gavel}
              title={t('common.empty')}
              description="Featured auctions appear here once they go live."
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
        <section className="pt-7">
          <SectionHeading
            title={t('home.endingSoon')}
            subtitle={t('home.endingSoonSub')}
            href="/auctions?status=ENDING_SOON"
          />
          <div className="space-y-3 px-4">
            {endingSoon.map((auction) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                favorited={favoriteSet.has(auction.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent winners */}
      {recentWinners.length > 0 && (
        <section className="pt-7">
          <SectionHeading title={t('auction.winner')} href="/wins" hrefLabel={t('wins.title')} />
          <ul className="gl-panel mx-4 divide-y divide-border">
            {recentWinners.map((win) => (
              <li key={win.id} className="flex items-center gap-3 p-3">
                <span className="gl-media h-10 w-10 shrink-0">
                  {win.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={win.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{win.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {win.winner} · <span className="font-mono">#{win.code}</span>
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {win.amount.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {win.currency === 'ETB' ? 'Br' : win.currency}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 pt-7">
        <SectionHeading title={t('home.howItWorks')} />
        <ol className="gl-panel mx-4 divide-y divide-border">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 p-4">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                  index === STEPS.length - 1
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
