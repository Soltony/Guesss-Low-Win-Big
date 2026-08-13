'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Gavel, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuctionCard } from './auction-card';
import { EmptyState } from './section-heading';
import { useLanguage } from './language-provider';
import type { PublicAuction } from '@/lib/miniapp-data';

interface Category {
  id: string;
  name: string;
  nameAm: string | null;
}

const STATUS_TABS = [
  { value: 'LIVE', label: 'Live' },
  { value: 'ENDING_SOON', label: 'Ending soon' },
  { value: 'ENDED', label: 'Finished' },
  { value: 'ALL', label: 'All' },
] as const;

export function AuctionsBrowser({
  auctions,
  total,
  categories,
  favorites,
  activeCategory,
  activeStatus,
  query,
}: {
  auctions: PublicAuction[];
  total: number;
  categories: Category[];
  favorites: string[];
  activeCategory: string;
  activeStatus: string;
  query: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang } = useLanguage();
  const [search, setSearch] = useState(query);
  const favoriteSet = new Set(favorites);

  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/auctions?${params.toString()}`);
  };

  return (
    <div className="pb-10">
      {/* Dark search header keeps the chrome continuous with the top bar. */}
      <div className="gl-ink gl-spotlight relative overflow-hidden px-4 pb-4 pt-5">
        <div className="gl-dots pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight">{t('nav.auctions')}</h1>
          <p className="mt-1 text-xs text-white/60">
            {total} {total === 1 ? 'auction' : 'auctions'} open to bid on
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: search || undefined });
            }}
            className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur focus-within:bg-white/15"
          >
            <Search className="h-4 w-4 shrink-0 text-white/60" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Item name or auction code"
              aria-label={t('common.search')}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  navigate({ q: undefined });
                }}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Status filter */}
      {/* top-14 matches the 56px top bar (h-8 logo + py-3). */}
      <div className="no-scrollbar sticky top-14 z-20 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => navigate({ status: tab.value })}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
              activeStatus === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
          <button
            type="button"
            onClick={() => navigate({ category: undefined })}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              !activeCategory
                ? 'border-foreground/25 bg-card text-foreground'
                : 'border-border bg-card/60 text-muted-foreground hover:text-foreground'
            )}
          >
            {t('common.all')}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => navigate({ category: category.id })}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeCategory === category.id
                  ? 'border-foreground/25 bg-card text-foreground'
                  : 'border-border bg-card/60 text-muted-foreground hover:text-foreground'
              )}
            >
              {lang === 'am' && category.nameAm ? category.nameAm : category.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4 px-4 pt-1">
        {auctions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="Nothing matches this filter"
            description="Try another category, or check back shortly."
          />
        ) : (
          auctions.map((auction, index) => (
            <AuctionCard
              key={auction.id}
              auction={auction}
              favorited={favoriteSet.has(auction.id)}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  );
}
