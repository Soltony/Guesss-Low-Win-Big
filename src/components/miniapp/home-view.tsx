'use client';

import Link from 'next/link';
import { ArrowRight, Flame, Gavel, Package, Sparkles, Trophy, Users } from 'lucide-react';
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
    title: 'Guess low — and unique',
    body: 'Submit an amount nobody else has picked. Many amounts allowed.',
  },
  {
    title: 'Everything stays sealed',
    body: 'Bid statuses are hidden while the auction runs, so nothing leaks.',
  },
  {
    title: 'Lowest unique bid wins',
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
    <div className="pb-10">
      {/* ---------- Hero ---------- */}
      <section className="gl-ink gl-spotlight relative overflow-hidden pb-16 pt-8">
        <div className="gl-dots pointer-events-none absolute inset-0 opacity-70" />

        <div className="relative px-4">
          <span className="gl-chip-dark">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t('app.platform')}
          </span>

          <h1 className="mt-4 text-[38px] font-extrabold leading-[1.05] tracking-tight">
            Guess <span className="text-primary">low</span>.
            <br />
            Win <span className="text-primary">big</span>.
          </h1>

          <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-white/70">
            {tagline ||
              'The lowest bid nobody else picked takes the prize — for a fraction of what it is worth.'}
          </p>

          {/* Stacked and full width on phones: two long labels side by side
              wrap into a ragged block at 390px. */}
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            <Link
              href="/auctions"
              className="gl-gold flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold"
            >
              {t('home.startBidding')}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#how-it-works"
              className="flex items-center justify-center rounded-xl border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t('home.howItWorks')}
            </Link>
          </div>
        </div>
      </section>

      {/* Stats card straddles the seam between the dark hero and the page.
          It needs its own stacking position: the hero above is `relative`, so a
          static sibling would paint underneath it and lose its top edge. */}
      <section className="relative z-10 -mt-11 px-4">
        <dl className="gl-card grid grid-cols-3 divide-x divide-border">
          {[
            { label: t('auction.live'), value: stats.liveAuctions, icon: Gavel },
            { label: t('auction.bids'), value: stats.totalBids, icon: Users },
            { label: t('auction.winner'), value: stats.totalWinners, icon: Trophy },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="px-3 py-4 text-center">
              <Icon className="mx-auto h-4 w-4 text-primary" strokeWidth={2} />
              <dd className="mt-2 text-2xl font-bold leading-none tabular-nums">
                {compactNumber(value)}
              </dd>
              <dt className="mt-1.5 text-[11px] font-medium capitalize text-muted-foreground">
                {label}
              </dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------- Categories ---------- */}
      {categories.length > 0 && (
        <section className="pt-8">
          <SectionHeading title={t('home.categories')} href="/auctions" hrefLabel="Browse all" />
          <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 pb-2">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/auctions?category=${category.id}`}
                className="gl-card gl-card-interactive flex w-[104px] shrink-0 flex-col items-center gap-2 p-3"
              >
                <span className="gl-product h-14 w-14 rounded-xl">
                  {category.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={category.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-2"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                  )}
                </span>
                <span className="line-clamp-2 text-center text-xs font-semibold leading-tight">
                  {lang === 'am' && category.nameAm ? category.nameAm : category.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Ending soon (urgency first) ---------- */}
      {endingSoon.length > 0 && (
        <section className="pt-8">
          <SectionHeading
            title={t('home.endingSoon')}
            subtitle={t('home.endingSoonSub')}
            href="/auctions?status=ENDING_SOON"
            icon={Flame}
          />
          <div className="space-y-4 px-4">
            {endingSoon.map((auction, index) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                favorited={favoriteSet.has(auction.id)}
                index={index}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---------- Featured ---------- */}
      <section className="pt-8">
        <SectionHeading
          title={t('home.featured')}
          subtitle={t('home.featuredSub')}
          href="/auctions"
        />
        <div className="space-y-4 px-4">
          {featured.length === 0 ? (
            <EmptyState
              icon={Gavel}
              title={t('common.empty')}
              description="Featured auctions appear here once they go live."
            />
          ) : (
            featured.map((auction, index) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                favorited={favoriteSet.has(auction.id)}
                index={index}
              />
            ))
          )}
        </div>
      </section>

      {/* ---------- Recent winners ---------- */}
      {recentWinners.length > 0 && (
        <section className="pt-8">
          <SectionHeading
            title="Recent winners"
            subtitle="Real prizes, real bids."
            href="/wins"
            hrefLabel={t('wins.title')}
            icon={Trophy}
          />
          <ul className="gl-card mx-4 divide-y divide-border overflow-hidden">
            {recentWinners.map((win) => (
              <li key={win.id} className="flex items-center gap-3 p-3">
                <span className="gl-product h-12 w-12 shrink-0 rounded-lg">
                  {win.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={win.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-1.5"
                      loading="lazy"
                    />
                  ) : (
                    <Trophy className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{win.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {win.winner} · <span className="font-mono">#{win.code}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Paid
                  </p>
                  <p className="text-base font-bold leading-none tabular-nums text-primary">
                    {win.amount.toFixed(2)}
                    <span className="ml-0.5 text-[11px] font-semibold text-muted-foreground">
                      {win.currency === 'ETB' ? 'Br' : win.currency}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- How it works ---------- */}
      <section id="how-it-works" className="scroll-mt-20 pt-8">
        <SectionHeading title={t('home.howItWorks')} subtitle="Four steps, no small print." />
        <ol className="grid gap-3 px-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="gl-card flex gap-3 p-4">
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                  index === STEPS.length - 1
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-4 px-4">
          <div className="gl-ink gl-spotlight relative overflow-hidden rounded-2xl p-5">
            <div className="gl-dots pointer-events-none absolute inset-0 opacity-60" />
            <div className="relative">
              <p className="text-sm font-semibold text-primary">Worked example</p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Bids of <strong className="text-white">1.00</strong> ×2,{' '}
                <strong className="text-white">2.00</strong> ×1,{' '}
                <strong className="text-white">3.00</strong> ×2,{' '}
                <strong className="text-white">4.00</strong> ×1.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Only 2.00 and 4.00 were picked once, so{' '}
                <strong className="text-primary">2.00 wins</strong> — not 1.00, even though it is
                lower.
              </p>
              <Link
                href="/auctions"
                className="gl-gold mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
              >
                {t('home.startBidding')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
