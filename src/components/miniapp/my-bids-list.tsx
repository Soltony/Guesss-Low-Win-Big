'use client';

import Link from 'next/link';
import { CheckCircle2, ChevronDown, Gavel, Loader2, Lock, Package, XCircle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Countdown } from './countdown';
import { MiniHero } from './section-heading';
import { useLanguage } from './language-provider';

interface Entry {
  auctionId: string;
  code: string;
  title: string;
  status: string;
  endAt: string;
  currency: string;
  imageUrl: string | null;
  revealed: boolean;
  bids: {
    id: string;
    amount: number;
    feeAmount: number;
    status: string;
    sequence: number;
    createdAt: string;
    isUnique: boolean | null;
    rank: number | null;
  }[];
}

function BidStatusIcon({ status }: { status: string }) {
  const { t } = useLanguage();

  if (status === 'PENDING_PAYMENT') {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('bid.pending')}
      </span>
    );
  }
  if (status === 'ACTIVE') {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('bid.confirmed')} />;
  }
  return (
    <XCircle
      className="h-4 w-4 text-muted-foreground"
      aria-label={status === 'FAILED' ? t('bid.failed') : t('bid.void')}
    />
  );
}

export function MyBidsList({ entries, totalSpent }: { entries: Entry[]; totalSpent: number }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<string | null>(entries[0]?.auctionId ?? null);

  const activeBids = entries.reduce(
    (sum, entry) => sum + entry.bids.filter((b) => b.status === 'ACTIVE').length,
    0
  );

  return (
    <div className="pb-10">
      <MiniHero
        title={t('nav.myBids')}
        subtitle="Your entries, grouped by auction."
        icon={Gavel}
        stats={[
          { label: 'Auctions', value: entries.length },
          { label: 'Confirmed', value: activeBids },
          { label: 'Fees paid', value: `${totalSpent.toFixed(0)} Br` },
        ]}
      />

      <ul className="space-y-3 px-4 pt-4">
        {entries.map((entry) => {
          const isOpen = open === entry.auctionId;
          const currency = entry.currency === 'ETB' ? 'Br' : entry.currency;
          const confirmed = entry.bids.filter((b) => b.status === 'ACTIVE').length;

          return (
            <li key={entry.auctionId} className="gl-card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : entry.auctionId)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="gl-product h-12 w-12 shrink-0 rounded-lg">
                  {entry.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.imageUrl}
                      alt=""
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">#{entry.code}</span> · {confirmed}{' '}
                    {t('auction.bids')}
                  </p>
                  <div className="mt-0.5 text-xs">
                    {entry.status === 'LIVE' ? (
                      <Countdown endAt={entry.endAt} />
                    ) : (
                      <span className="text-muted-foreground">
                        {entry.status === 'SETTLED' ? 'Result published' : t('auction.ended')}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border">
                  {!entry.revealed && (
                    <p className="flex items-start gap-1.5 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
                      <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                      {t('bid.hiddenUntilEnd')}
                    </p>
                  )}

                  <ul className="divide-y divide-border">
                    {entry.bids.map((bid) => (
                      <li
                        key={bid.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <span className="text-sm font-semibold tabular-nums">
                          {bid.amount.toFixed(2)}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            {currency}
                          </span>
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            #{bid.sequence}
                          </span>
                        </span>

                        <span className="flex items-center gap-3">
                          {entry.revealed && bid.isUnique !== null && (
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
                          <BidStatusIcon status={bid.status} />
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/auctions/${entry.code}`}
                    className="block border-t border-border py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {t('auction.viewDetails')} →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
