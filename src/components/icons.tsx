import { cn } from '@/lib/utils';

/** HowLow mark: a gavel striking a descending bid line. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-8 w-8', className)}
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="12" fill="currentColor" fillOpacity="0.12" />
      <path
        d="M10 34h20"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="14.5"
        y="12"
        width="16"
        height="8"
        rx="2.5"
        transform="rotate(-40 14.5 12)"
        fill="currentColor"
      />
      <path
        d="M22 21.5 30.5 30"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M33 14h5v5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M38 14 30 22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-bold tracking-tight', className)}>
      <Logo className="h-7 w-7" />
      <span>
        How<span className="text-accent">Low</span>
      </span>
    </span>
  );
}
