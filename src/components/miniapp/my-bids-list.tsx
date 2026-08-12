'use client';

import Link from 'next/link';
import { CheckCircle2, ChevronDown, Gavel, Loader2, Lock, XCircle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Countdown } from './countdown';
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

function StatusPill({ status }: { status: string }) {
  const { t } = useLanguage();

  if (status === 'PENDING_PAYMENT') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-warning">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('bid.pending')}
      </span>
    );
  }
  if (status === 'ACTIVE') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t('bid.confirmed')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" />
      {status === 'FAILED' ? t('bid.failed') : t('bid.void')}
    </span>
  );
}

export function MyBidsList({
  entries,
  totalSpent,
}: {
  entries: Entry[];
  totalSpent: number;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<string | null>(entries[0]?.auctionId ?? null);

  const activeBids = entries.reduce(
    (sum, entry) => sum + entry.bids.filter((b) => b.status === 'ACTIVE').length,
    0
  );

  return (
    <div className="pb-6">
      <div className="howlow-hero px-4 py-5 text-white">
        <h1 className="text-2xl font-bold">{t('nav.myBids')}</h1>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{entries.length}</p>
            <p className="text-[11px] uppercase opacity-90">Auctions</p>
          </div>
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{activeBids}</p>
            <p className="text-[11px] uppercase opacity-90">Confirmed bids</p>
          </div>
          <div className="rounded-xl bg-white/15 py-2">
            <p className="text-xl font-bold tabular-nums">{totalSpent.toFixed(0)}</p>
            <p className="text-[11px] uppercase opacity-90">Fees paid</p>
          </div>
        </div>
      </div>

      <ul className="space-y-3 px-4 pt-4">
        {entries.map((entry) => {
          const isOpen = open === entry.auctionId;
          const currency = entry.currency === 'ETB' ? 'Br' : entry.currency;
          const confirmed = entry.bids.filter((b) => b.status === 'ACTIVE').length;

          return (
            <li
              key={entry.auctionId}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : entry.auctionId)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-secondary/40"
              >
                {entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.imageUrl}
                    alt=""
                    className="h-14 w-14 rounded-lg object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-secondary">
                    <Gavel className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">
                    #{entry.code} · {confirmed} {t('auction.bids')}
                  </p>
                  <div className="mt-0.5 text-xs">
                    {entry.status === 'LIVE' ? (
                      <Countdown endAt={entry.endAt} compact />
                    ) : (
                      <span className="font-semibold text-muted-foreground">
                        {entry.status === 'SETTLED' ? 'Result published' : t('auction.ended')}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronDown
                  className={cn(
                    'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border px-3 py-3">
                  {!entry.revealed && (
                    <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      {t('bid.hiddenUntilEnd')}
                    </p>
                  )}

                  <ul className="space-y-1.5">
                    {entry.bids.map((bid) => (
                      <li
                        key={bid.id}
                        className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2"
                      >
                        <div>
                          <span className="font-bold tabular-nums">
                            {bid.amount.toFixed(2)}{' '}
                            <span className="text-xs font-medium text-muted-foreground">
                              {currency}
                            </span>
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">#{bid.sequence}</span>
                        </div>

                        <div className="flex items-center gap-3">
                          {entry.revealed && bid.isUnique !== null && (
                            <span
                              className={cn(
                                'text-xs font-bold',
                                bid.isUnique ? 'text-primary' : 'text-muted-foreground'
                              )}
                            >
                              {bid.isUnique ? t('bid.unique') : t('bid.taken')}
                              {bid.rank ? ` · #${bid.rank}` : ''}
                            </span>
                          )}
                          <StatusPill status={bid.status} />
                        </div>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/auctions/${entry.code}`}
                    className="mt-3 block rounded-lg border border-border py-2 text-center text-sm font-semibold transition hover:bg-secondary"
                  >
                    {t('auction.viewDetails')}
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
