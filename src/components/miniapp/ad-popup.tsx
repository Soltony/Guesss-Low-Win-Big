'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, X } from 'lucide-react';
import { useLanguage } from './language-provider';

interface PopupAd {
  id: string;
  title: string;
  titleAm: string | null;
  body: string | null;
  bodyAm: string | null;
  imageUrl: string | null;
  /** Text alternative for the artwork; null means it is purely decorative. */
  imageAlt: string | null;
  ctaLabel: string | null;
  ctaLabelAm: string | null;
  linkUrl: string | null;
  autoCloseSeconds: number;
  /** The ad has to stay on screen this long before it can be dismissed. */
  minViewSeconds: number;
}

/**
 * Promotional popup shown once a bidder has a live session. The server decides
 * what is due — scheduling, frequency caps and the master switch all live in
 * `lib/ads.ts` — so this component only queues and renders what it is handed.
 *
 * Dismissal is deliberately the single X: an ad with `minViewSeconds` holds it
 * locked, counting down, so the close is the only thing a bidder has to find.
 */
export function AdPopup() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [queue, setQueue] = useState<PopupAd[]>([]);
  const [servedCount, setServedCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const viewed = useRef<Set<string>>(new Set());

  const ad = queue[0];
  // Position in the batch, counted from what was delivered rather than what is
  // left, so a queue of three reads 1/3 → 2/3 → 3/3.
  const position = servedCount - queue.length + 1;

  // Asked on every mount. The server serves one batch per sign-in, so the
  // browsing that follows a login gets a single popup without this component
  // having to remember anything — webview storage outlives a mini-app open in
  // ways that silently swallowed the popup on the second visit.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    fetch('/api/miniapp/ads')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.ads?.length) return;
        setQueue(data.ads);
        setServedCount(data.ads.length);
        timer = setTimeout(() => !cancelled && setVisible(true), (data.delaySeconds || 0) * 1000);
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const next = useCallback(() => {
    setQueue((prev) => prev.slice(1));
    setElapsedMs(0);
  }, []);

  // Reports the card that is on screen. This is the impression the frequency cap
  // is measured from, so it fires per card and only once each — a bidder who
  // closes the app mid-queue leaves the rest unspent for their next visit.
  useEffect(() => {
    if (!visible || !ad || viewed.current.has(ad.id)) return;
    viewed.current.add(ad.id);

    fetch('/api/miniapp/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adId: ad.id, event: 'view' }),
    }).catch(() => null);
  }, [visible, ad]);

  // One ticker drives both countdowns. It measures against the wall clock so a
  // backgrounded webview cannot stretch a forced view past its real duration.
  useEffect(() => {
    if (!visible || !ad) return;

    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(interval);
  }, [visible, ad?.id]);

  const lockMs = (ad?.minViewSeconds ?? 0) * 1000;
  const lockRemainingMs = Math.max(0, lockMs - elapsedMs);
  const locked = lockRemainingMs > 0;
  const lockSecondsLeft = Math.ceil(lockRemainingMs / 1000);
  const lockProgress = lockMs > 0 ? Math.min(100, (elapsedMs / lockMs) * 100) : 100;

  const close = useCallback(() => {
    if (lockRemainingMs > 0) return;
    next();
  }, [lockRemainingMs, next]);

  // Auto-dismiss. Never fires before the forced view — the API rejects that
  // combination — so the two countdowns cannot contradict each other.
  useEffect(() => {
    if (!visible || !ad?.autoCloseSeconds) return;
    if (elapsedMs >= ad.autoCloseSeconds * 1000) next();
  }, [elapsedMs, visible, ad, next]);

  // Escape closes once unlocked, and the page behind must not scroll.
  useEffect(() => {
    if (!visible || !ad) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [visible, ad, close]);

  if (!visible || !ad) return null;

  const title = (lang === 'am' && ad.titleAm) || ad.title;
  const body = (lang === 'am' && ad.bodyAm) || ad.body;
  const ctaLabel = (lang === 'am' && ad.ctaLabelAm) || ad.ctaLabel || t('auction.viewDetails');

  const openLink = () => {
    if (!ad.linkUrl) return;

    // Fire-and-forget: the navigation must not wait on the click counter.
    fetch('/api/miniapp/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adId: ad.id, event: 'click' }),
    }).catch(() => null);

    // Tapping through ends the whole batch, not just this card: the bidder has
    // acted on an ad and is being sent somewhere: greeting them with the next
    // popup on the destination page would bury the thing they just asked for.
    // It also bypasses the forced view rather than trapping someone engaging.
    setQueue([]);
    if (ad.linkUrl.startsWith('/')) router.push(ad.linkUrl);
    else window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gl-ad-title"
      onClick={close}
    >
      <div
        className="gl-card relative w-full max-w-sm overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Forced view: a hairline of progress so the wait reads as finite. */}
        {locked && (
          <div className="absolute inset-x-0 top-0 z-10 h-1 bg-black/10">
            <div
              className="h-full bg-primary transition-[width] duration-200 ease-linear"
              style={{ width: `${lockProgress}%` }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={close}
          disabled={locked}
          aria-label={
            locked ? `${t('ads.closesIn')} ${lockSecondsLeft}s` : t('common.close')
          }
          className={`absolute right-2 top-2 z-10 flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-white transition-colors ${
            locked ? 'cursor-not-allowed bg-black/40' : 'bg-black/50 hover:bg-black/70'
          }`}
        >
          {locked ? (
            <span className="text-xs font-bold tabular-nums">{lockSecondsLeft}</span>
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>

        {ad.imageUrl && (
          // Artwork is supplied at whatever aspect the advertiser has; contain
          // keeps logos and text inside the frame instead of cropping them.
          <div className="flex items-center justify-center bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* Advertiser creative usually carries its message inside the
                image. Empty alt is the fallback for artwork that adds nothing
                to the title and body below it. */}
            <img
              src={ad.imageUrl}
              alt={ad.imageAlt?.trim() || ''}
              className="max-h-56 w-full object-contain"
            />
          </div>
        )}

        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('ads.sponsored')}
            </p>
            {servedCount > 1 && (
              <p className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {position} / {servedCount}
              </p>
            )}
          </div>

          <h2 id="gl-ad-title" className="mt-1.5 text-lg font-bold leading-tight">
            {title}
          </h2>
          {body && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>}

          {ad.linkUrl && (
            <button
              type="button"
              onClick={openLink}
              className="gl-gold mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
