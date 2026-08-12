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
    <div className="pb-8">
      <div className="border-b border-border bg-card px-4 pb-3 pt-4">
        <h1 className="text-lg font-semibold tracking-tight">{t('nav.auctions')}</h1>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ q: search || undefined });
          }}
          className="mt-3 flex items-center gap-2 rounded-md border border-input px-3 py-2 focus-within:ring-2 focus-within:ring-ring"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Item name or auction code"
            aria-label={t('common.search')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                navigate({ q: undefined });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        {/* Status: underline tabs rather than filled pills */}
        <div className="no-scrollbar -mb-3 mt-3 flex gap-4 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => navigate({ status: tab.value })}
              className={cn(
                'shrink-0 border-b-2 pb-2.5 text-sm font-medium transition-colors',
                activeStatus === tab.value
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
          <button
            type="button"
            onClick={() => navigate({ category: undefined })}
            className={cn(
              'shrink-0 rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              !activeCategory
                ? 'border-foreground/30 bg-secondary text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
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
                'shrink-0 whitespace-nowrap rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                activeCategory === category.id
                  ? 'border-foreground/30 bg-secondary text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
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

      <div className="space-y-3 px-4">
        {auctions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="Nothing matches this filter"
            description="Try another category, or check back shortly."
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
