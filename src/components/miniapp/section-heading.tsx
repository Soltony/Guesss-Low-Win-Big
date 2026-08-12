import Link from 'next/link';

/**
 * Left-aligned section opener with a thin brand rule — replaces centred banner
 * headings so the page reads as one continuous, quiet column.
 */
export function SectionHeading({
  title,
  subtitle,
  href,
  hrefLabel = 'See all',
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-4">
      <div className="gl-section-rule">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {hrefLabel} →
        </Link>
      )}
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
    <div className="gl-panel flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
