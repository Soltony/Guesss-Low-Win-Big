import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * Left-aligned section opener with a gold rule, so the page reads as one
 * continuous column instead of a stack of centred banners.
 */
export function SectionHeading({
  title,
  subtitle,
  href,
  hrefLabel = 'See all',
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-4">
      <div className="gl-section-rule">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          {Icon && <Icon className="h-4 w-4 text-accent" strokeWidth={2.25} />}
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 whitespace-nowrap text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel} →
        </Link>
      )}
    </div>
  );
}

/**
 * Dark page header with an optional stat strip. Shared by My Bids, My Wins and
 * Profile so the chrome stays continuous with the top bar on every screen.
 */
export function MiniHero({
  title,
  subtitle,
  icon: Icon,
  stats,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  stats?: { label: string; value: string | number }[];
}) {
  return (
    <div className="gl-ink gl-spotlight relative overflow-hidden px-4 pb-5 pt-5">
      <div className="gl-dots pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          {Icon && <Icon className="h-5 w-5 text-primary" strokeWidth={2.25} />}
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-xs text-white/60">{subtitle}</p>}

        {stats && stats.length > 0 && (
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl bg-white/10 px-2 py-2.5 text-center backdrop-blur"
              >
                <dd className="text-lg font-bold leading-none tabular-nums">{stat.value}</dd>
                <dt className="mt-1.5 text-[10px] uppercase tracking-wide text-white/55">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="gl-card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
