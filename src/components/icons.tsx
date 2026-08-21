'use client';

import { cn } from '@/lib/utils';
import { useBrandLogo, useBrandName } from '@/components/brand-provider';

/**
 * GuessLow mark: descending bars with the lowest one picked out — the whole
 * proposition in one glyph. Used when no icon has been uploaded under
 * Content → Branding; drawn inline so it picks up `currentColor` and the theme
 * primary wherever it is placed.
 */
function DefaultMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-7 w-7', className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="7" y="9" width="4" height="14" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="14" y="13" width="4" height="10" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="21" y="17" width="4" height="6" rx="1.5" fill="currentColor" />
      <circle cx="23" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/** The app icon: the uploaded artwork when one is set, else the built-in mark. */
export function Logo({ className }: { className?: string }) {
  const logoUrl = useBrandLogo();

  if (!logoUrl) return <DefaultMark className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      className={cn('h-7 w-7 rounded-lg object-contain', className)}
    />
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  const name = useBrandName();

  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <Logo className="h-7 w-7 text-foreground" />
      <span>{name}</span>
    </span>
  );
}
