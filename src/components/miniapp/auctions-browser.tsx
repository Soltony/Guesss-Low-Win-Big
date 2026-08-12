'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Gavel, Search } from 'lucide-react';
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
    <div className="pb-6">
      <div className="howlow-hero px-4 pb-5 pt-5">
        <h1 className="text-2xl font-bold text-white">{t('nav.auctions')}</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ q: search || undefined });
          }}
          className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm"
        >
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`${t('common.search')} — name or auction code`}
            aria-label={t('common.search')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                navigate({ q: undefined });
              }}
              className="text-xs font-semibold text-muted-foreground"
            >
              {t('common.cancel')}
            </button>
          )}
        </form>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-border bg-card px-4 py-3">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => navigate({ status: tab.value })}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition',
              activeStatus === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/70'
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
              'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition',
              !activeCategory
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground'
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
                'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition',
                activeCategory === category.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground'
              )}
            >
              {lang === 'am' && category.nameAm ? category.nameAm : category.name}
            </button>
          ))}
        </div>
      )}

      <p className="px-4 pb-2 text-xs text-muted-foreground">
        {total} {total === 1 ? 'auction' : 'auctions'}
      </p>

      <div className="space-y-4 px-4">
        {auctions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No auctions match this filter"
            description="Try a different category or check back soon."
          />
        ) : (
          auctions.map((auction) => (
            <AuctionCard
              key={auction.id}
              auction={auction}
              favorited={favoriteSet.has(auction.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
