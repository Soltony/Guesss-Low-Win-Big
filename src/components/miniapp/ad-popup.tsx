'use client';

import { useCallback, useEffect, useState } from 'react';
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
  ctaLabel: string | null;
  ctaLabelAm: string | null;
  linkUrl: string | null;
  autoCloseSeconds: number;
}

/** Once per app open — a remount while browsing must not re-serve the popup,
 *  and the fetch itself is what records the impression. */
const SESSION_KEY = 'guesslow.ads.served';

/**
 * Promotional popup shown once a bidder has a live session. The server decides
 * what is due — scheduling, frequency caps and the master switch all live in
 * `lib/ads.ts` — so this component only queues and renders what it is handed.
 */
export function AdPopup() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [queue, setQueue] = useState<PopupAd[]>([]);
  const [visible, setVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const ad = queue[0];

  useEffect(() => {
    if (window.sessionStorage.getItem(SESSION_KEY)) return;
    // Claimed before the request goes out: React re-runs effects in dev, and a
    // second fetch would burn a second impression.
    window.sessionStorage.setItem(SESSION_KEY, '1');

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    fetch('/api/miniapp/ads')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.ads?.length) return;
        setQueue(data.ads);
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
    setSecondsLeft(null);
  }, []);

  // Auto-dismiss, when the ad asks for it.
  useEffect(() => {
    if (!visible || !ad?.autoCloseSeconds) return;

    setSecondsLeft(ad.autoCloseSeconds);
    const interval = setInterval(() => {
      setSecondsLeft((value) => {
        if (value === null) return null;
        if (value <= 1) {
          clearInterval(interval);
          next();
          return null;
        }
        return value - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, ad?.id, ad?.autoCloseSeconds, next]);

  // Escape closes, and the page behind must not scroll while the popup is up.
  useEffect(() => {
    if (!visible || !ad) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') next();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [visible, ad, next]);

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
      body: JSON.stringify({ adId: ad.id }),
    }).catch(() => null);

    next();
    if (ad.linkUrl.startsWith('/')) router.push(ad.linkUrl);
    else window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gl-ad-title"
      onClick={next}
    >
      <div
        className="gl-card relative w-full max-w-sm overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={next}
          aria-label={t('common.close')}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        >
          <X className="h-4 w-4" />
        </button>

        {ad.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="max-h-64 w-full object-cover" />
        )}

        <div className="space-y-2 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('ads.sponsored')}
          </p>
          <h2 id="gl-ad-title" className="text-lg font-bold leading-tight">
            {title}
          </h2>
          {body && <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>}

          <div className="flex flex-col gap-2 pt-2">
            {ad.linkUrl && (
              <button
                type="button"
                onClick={openLink}
                className="gl-gold flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              {queue.length > 1 ? t('ads.next') : t('ads.dismiss')}
              {secondsLeft !== null && <span className="ml-1 tabular-nums">({secondsLeft})</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
