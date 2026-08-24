'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Crown, Loader2, ScrollText, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from './language-provider';
import type { HistogramBar, LedgerOverview, LedgerRow, LedgerScope } from '@/lib/bid-ledger';

interface Props {
  auctionCode: string;
  currency: string;
  overview: LedgerOverview;
  winnerName: string | null;
  connected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The published record of a settled auction, as a bottom sheet.
 *
 * The reference this replaces was a flat list of every amount behind a "load
 * more" button — 700 rows deep on a busy auction, which nobody scrolls, so the
 * one thing it was meant to prove stayed buried. This opens on the stretch that
 * actually decided the result instead: the amounts below the winner, every one
 * of them matched. The whole space is a tab away, and a reader chasing one
 * number can type it in rather than page down to it.
 */
export function BidLedgerSheet({
  auctionCode,
  currency,
  overview,
  winnerName,
  connected,
  open,
  onOpenChange,
}: Props) {
  const { t } = useLanguage();

  // With no winner there is no decisive stretch to open on, so the whole space
  // is the only honest default.
  const defaultScope: LedgerScope = overview.winningAmount === null ? 'all' : 'proof';

  const [scope, setScope] = useState<LedgerScope>(defaultScope);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  // A scope switch and a "load more" can be in flight together; only the most
  // recent request may write to the list, or a slow first page lands on top of
  // the page the reader is already reading.
  const requestId = useRef(0);

  const load = useCallback(
    async (next: LedgerScope, after: number | null) => {
      const id = ++requestId.current;
      setLoading(true);
      setFailed(false);

      const params = new URLSearchParams({ scope: next });
      if (after !== null) params.set('cursor', String(after));

      try {
        const res = await fetch(`/api/miniapp/auctions/${auctionCode}/ledger?${params}`);
        const data = await res.json();
        if (id !== requestId.current) return;
        if (!res.ok) throw new Error(data?.error || 'failed');

        setRows((current) => (after === null ? data.rows : [...current, ...data.rows]));
        setCursor(data.nextCursor ?? null);
      } catch {
        if (id === requestId.current) setFailed(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [auctionCode]
  );

  // The sheet is mounted with the page, so the first page waits until it is
  // actually opened rather than costing every visitor a request.
  useEffect(() => {
    if (!open || !overview.published) return;
    setScope(defaultScope);
    setQuery('');
    setSearching(false);
    load(defaultScope, null);
  }, [open, overview.published, defaultScope, load]);

  function changeScope(next: LedgerScope) {
    setScope(next);
    setQuery('');
    setSearching(false);
    setRows([]);
    setCursor(null);
    load(next, null);
  }

  /** Looks up one amount directly, whichever scope is showing. */
  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(query);
    if (!Number.isFinite(amount)) return;

    const id = ++requestId.current;
    setSearching(true);
    setLoading(true);
    setFailed(false);

    try {
      const res = await fetch(
        `/api/miniapp/auctions/${auctionCode}/ledger?amount=${encodeURIComponent(amount)}`
      );
      const data = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(data?.error || 'failed');
      setRows(data.rows);
      setCursor(null);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function clearSearch() {
    setQuery('');
    setSearching(false);
    setRows([]);
    setCursor(null);
    load(scope, null);
  }

  /** Swaps one row's bidder preview for the full list. */
  async function expandRow(amount: number) {
    const params = new URLSearchParams({
      amount: String(amount),
      expand: String(amount),
    });
    try {
      const res = await fetch(`/api/miniapp/auctions/${auctionCode}/ledger?${params}`);
      const data = await res.json();
      const full: LedgerRow | undefined = data?.rows?.[0];
      if (!full) return;
      setRows((current) => current.map((row) => (row.amount === amount ? full : row)));
    } catch {
      /* The collapsed row stays as it was; the reader can tap again. */
    }
  }

  const scopes: { value: LedgerScope; label: string }[] = [
    ...(overview.winningAmount !== null
      ? [{ value: 'proof' as const, label: t('ledger.whyWon') }]
      : []),
    { value: 'all', label: t('ledger.allAmounts') },
    ...(connected ? [{ value: 'mine' as const, label: t('ledger.myAmounts') }] : []),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focusing the search field first would raise the keyboard over the
            // summary the reader came here to read.
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-[0_-16px_44px_-16px_hsl(224_47%_9%/0.45)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-200 data-[state=open]:duration-300"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />

          <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
            <ScrollText className="h-5 w-5 shrink-0 text-primary" />
            <Dialog.Title className="flex-1 text-sm font-bold leading-tight">
              {t('ledger.title')}
              <span className="ml-2 font-mono text-[11px] font-medium text-muted-foreground">
                #{auctionCode}
              </span>
            </Dialog.Title>
            <Dialog.Close
              aria-label={t('common.close')}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            {!overview.published ? (
              <p className="gl-panel px-4 py-8 text-center text-xs text-muted-foreground">
                {t('ledger.notPublished')}
              </p>
            ) : (
              <>
                <Summary
                  overview={overview}
                  currency={currency}
                  winnerName={winnerName}
                  labels={{
                    total: t('ledger.totalBids'),
                    cancelled: t('ledger.cancelled'),
                    alone: t('ledger.stoodAlone'),
                    amounts: t('ledger.amounts'),
                    winner: t('auction.winner'),
                    explainer: t('ledger.explainer'),
                    // Nothing below the winner means there was nothing to
                    // cancel out, so the "every amount below it was matched"
                    // sentence would be counting to zero.
                    proof:
                      overview.winningAmount === null
                        ? t('ledger.proofNoWinner')
                        : overview.matchedBelowWinner === 0
                          ? t('ledger.proofLowest', {
                              winning: `${overview.winningAmount.toFixed(2)} ${currency}`,
                            })
                          : t('ledger.proof', {
                              matched: overview.matchedBelowWinner,
                              winning: `${overview.winningAmount.toFixed(2)} ${currency}`,
                            }),
                  }}
                />

                {/* ---------- Controls ---------- */}
                <div className="sticky top-0 z-10 -mx-4 mt-5 bg-card/95 px-4 pb-2 pt-1 backdrop-blur">
                  <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-2">
                    {scopes.map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        onClick={() => changeScope(entry.value)}
                        aria-pressed={!searching && scope === entry.value}
                        className={cn(
                          'shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                          !searching && scope === entry.value
                            ? 'bg-foreground text-background'
                            : 'bg-secondary text-muted-foreground'
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={runSearch} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        inputMode="decimal"
                        placeholder={t('ledger.checkAmount')}
                        aria-label={t('ledger.checkAmount')}
                        className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm tabular-nums outline-none focus:border-primary"
                      />
                    </div>
                    {searching ? (
                      <button
                        type="button"
                        onClick={clearSearch}
                        className="shrink-0 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground"
                      >
                        {t('common.cancel')}
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={query.trim() === ''}
                        className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-background disabled:opacity-40"
                      >
                        {t('common.search')}
                      </button>
                    )}
                  </form>
                </div>

                {/* ---------- Rows ---------- */}
                <ul className="gl-panel mt-2 divide-y divide-border">
                  {rows.map((row) => (
                    <LedgerRowItem
                      key={row.amount}
                      row={row}
                      currency={currency}
                      showBidders={overview.showBidders}
                      onExpand={() => expandRow(row.amount)}
                      labels={{
                        taken: t('ledger.taken'),
                        unique: t('ledger.unique'),
                        winner: t('ledger.winnerRow'),
                        yours: t('ledger.yourBid'),
                        bids: row.bidCount === 1 ? t('ledger.oneBid') : t('ledger.bidsAt', { count: row.bidCount }),
                        more: t('ledger.seeAll', { count: row.bidCount - row.bidders.length }),
                      }}
                    />
                  ))}
                </ul>

                {rows.length === 0 && !loading && (
                  <p className="gl-panel mt-2 px-4 py-8 text-center text-xs text-muted-foreground">
                    {searching ? t('ledger.noMatch') : t('common.empty')}
                  </p>
                )}

                {failed && (
                  <button
                    type="button"
                    onClick={() => load(scope, cursor)}
                    className="mt-3 w-full rounded-xl border border-border py-3 text-xs font-bold text-muted-foreground"
                  >
                    {t('common.retry')}
                  </button>
                )}

                {loading && (
                  <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('common.loading')}
                  </p>
                )}

                {cursor !== null && !loading && (
                  <button
                    type="button"
                    onClick={() => load(scope, cursor)}
                    className="mt-3 w-full rounded-xl border border-border py-3 text-xs font-bold"
                  >
                    {t('ledger.loadMore')}
                  </button>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'gold' }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p
        className={cn(
          'text-lg font-extrabold leading-none tabular-nums',
          tone === 'gold' && 'text-primary'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Summary({
  overview,
  currency,
  winnerName,
  labels,
}: {
  overview: LedgerOverview;
  currency: string;
  winnerName: string | null;
  labels: Record<'total' | 'cancelled' | 'alone' | 'amounts' | 'winner' | 'explainer' | 'proof', string>;
}) {
  return (
    <>
      <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{labels.explainer}</p>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
        <Stat label={labels.total} value={overview.totalBids.toLocaleString('en-US')} />
        <Stat label={labels.cancelled} value={overview.matchedBids.toLocaleString('en-US')} />
        <Stat label={labels.alone} value={overview.uniqueBids.toLocaleString('en-US')} />
        <Stat label={labels.amounts} value={overview.amountCount.toLocaleString('en-US')} />
      </dl>

      {overview.winningAmount !== null && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary">
            <Crown className="h-4 w-4 text-primary-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {labels.winner}
            </p>
            <p className="truncate text-sm font-bold">{winnerName ?? '—'}</p>
          </div>
          <p className="shrink-0 text-xl font-extrabold tabular-nums text-primary">
            {overview.winningAmount.toFixed(2)}
            <span className="ml-1 text-xs font-semibold text-muted-foreground">{currency}</span>
          </p>
        </div>
      )}

      {overview.histogram.length > 1 && (
        <Strip bars={overview.histogram} currency={currency} overview={overview} />
      )}

      <p className="mt-3 rounded-xl bg-secondary/70 px-3 py-2.5 text-xs leading-relaxed">
        {labels.proof}
      </p>
    </>
  );
}

/**
 * The whole bid space as one row of bars — how many bids landed on each amount,
 * cheapest on the left, with the winner marked.
 *
 * It is the one view that makes the result obvious without reading a number:
 * a dense wall of contested amounts at the bottom of the range, thinning out,
 * and the winning bid sitting at the first gap in it.
 */
function Strip({
  bars,
  currency,
  overview,
}: {
  bars: HistogramBar[];
  currency: string;
  overview: LedgerOverview;
}) {
  const peak = Math.max(...bars.map((bar) => bar.bidCount), 1);
  const step = 4;
  const height = 44;

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${bars.length * step} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Bids per amount, from ${overview.lowestAmount?.toFixed(2) ?? ''} upwards`}
        className="h-12 w-full"
      >
        {bars.map((bar, index) => {
          // A bar that exists at all gets a visible floor, so a lonely single
          // bid next to a hundred-bid amount does not vanish into the axis.
          const scaled = Math.max(2, Math.round((bar.bidCount / peak) * height));
          return (
            <rect
              key={index}
              x={index * step}
              y={height - scaled}
              width={step - 1}
              height={scaled}
              fill={
                bar.winner
                  ? 'hsl(var(--primary))'
                  : bar.unique
                    ? 'hsl(var(--accent))'
                    : 'hsl(var(--muted-foreground))'
              }
              opacity={bar.winner ? 1 : bar.unique ? 0.75 : 0.35}
            />
          );
        })}
      </svg>

      <figcaption className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">
          {overview.lowestAmount?.toFixed(2)} {currency}
        </span>
        <span className="flex items-center gap-2">
          <Legend color="hsl(var(--muted-foreground))" opacity={0.35} label="matched" />
          <Legend color="hsl(var(--accent))" opacity={0.75} label="alone" />
          <Legend color="hsl(var(--primary))" opacity={1} label="winner" />
        </span>
      </figcaption>
    </figure>
  );
}

function Legend({ color, opacity, label }: { color: string; opacity: number; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="h-2 w-2 rounded-[2px]"
        style={{ backgroundColor: color, opacity }}
      />
      {label}
    </span>
  );
}

function LedgerRowItem({
  row,
  currency,
  showBidders,
  onExpand,
  labels,
}: {
  row: LedgerRow;
  currency: string;
  showBidders: boolean;
  onExpand: () => void;
  labels: Record<'taken' | 'unique' | 'winner' | 'yours' | 'bids' | 'more', string>;
}) {
  const isWinner = row.uniqueRank === 1;

  return (
    <li className={cn('px-4 py-3', isWinner && 'bg-primary/10')}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-bold tabular-nums">
          {row.amount.toFixed(2)}{' '}
          <span className="text-xs font-medium text-muted-foreground">{currency}</span>
        </p>

        <div className="flex shrink-0 items-center gap-1.5">
          {row.mine && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
              {labels.yours}
            </span>
          )}
          {/* Neutral for a matched amount rather than an error colour: being
              matched is the ordinary outcome, not a fault in anybody's bid. */}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold',
              isWinner
                ? 'bg-primary text-primary-foreground'
                : row.isUnique
                  ? 'bg-accent/15 text-accent'
                  : 'bg-secondary text-muted-foreground'
            )}
          >
            {isWinner ? labels.winner : row.isUnique ? labels.unique : labels.taken}
          </span>
        </div>
      </div>

      <p className="mt-0.5 text-[11px] text-muted-foreground">{labels.bids}</p>

      {showBidders && row.bidders.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {row.bidders.map((bidder, index) => (
            <span
              key={`${bidder}-${index}`}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                row.mineIndexes.includes(index)
                  ? 'bg-foreground text-background'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {bidder}
            </span>
          ))}

          {row.truncated && (
            <button
              type="button"
              onClick={onExpand}
              className="rounded px-1.5 py-0.5 text-[10px] font-bold text-success"
            >
              {labels.more}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
