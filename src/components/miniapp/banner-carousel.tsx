'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useLanguage } from './language-provider';

export interface HomeBanner {
  id: string;
  title: string;
  titleAm: string | null;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
}

/**
 * Promotional strip at the top of the home screen. The server has already
 * applied the schedule window, the ACTIVE filter and `displayOrder` in
 * `getHomeData`, so whatever arrives here is shown in the order it arrives.
 *
 * Artwork is `cover`-cropped to a fixed band: unlike the ad popup — which
 * contains arbitrary advertiser artwork — a banner is a designed wide image,
 * and a consistent band is what keeps the carousel from jumping between
 * uploads of different aspect ratios. Copy sits on a scrim rather than beside
 * the image so it stays legible over both light and dark artwork.
 */
export function BannerCarousel({ banners }: { banners: HomeBanner[] }) {
  const { lang } = useLanguage();
  if (banners.length === 0) return null;

  const multiple = banners.length > 1;

  return (
    <section className="pt-8" aria-label="Promotions">
      {/* Cards stop short of full width when there is more than one, so the
          next banner peeks in — the only affordance that a horizontal scroll
          exists on a touch device with no visible scrollbar. */}
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4">
        {banners.map((banner) => {
          const title = (lang === 'am' && banner.titleAm) || banner.title;

          const className = cn(
            'gl-card relative aspect-[2/1] shrink-0 snap-center overflow-hidden',
            multiple ? 'w-[88%]' : 'w-full',
            banner.linkUrl && 'gl-card-interactive'
          );

          // `alt` is empty because the title below is real text in the same
          // card — a screen reader would otherwise hear the headline twice.
          const content = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={banner.imageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-3.5 pt-10">
                <p className="text-sm font-bold leading-tight text-white">{title}</p>
                {banner.subtitle && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/75">
                    {banner.subtitle}
                  </p>
                )}
              </div>
            </>
          );

          if (!banner.linkUrl) {
            return (
              <div key={banner.id} className={className}>
                {content}
              </div>
            );
          }

          // Same split as the ad popup: in-app paths route through the client
          // router, anything else is an outbound link and leaves the mini-app.
          return banner.linkUrl.startsWith('/') ? (
            <Link key={banner.id} href={banner.linkUrl} className={className}>
              {content}
            </Link>
          ) : (
            <a
              key={banner.id}
              href={banner.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {content}
            </a>
          );
        })}
      </div>
    </section>
  );
}
