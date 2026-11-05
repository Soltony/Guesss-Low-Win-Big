import type { ComponentType, ReactNode } from 'react';
import { BrandPanel, ConsoleRibbon } from './brand-panel';

/**
 * Filled fields rather than outlined ones: the panel is already a plain white
 * surface, so the input's own tint is what tells you where to type.
 */
export const AUTH_FIELD =
  'h-12 rounded-xl border-transparent bg-secondary pl-11 text-[15px] transition-colors focus-visible:bg-card focus-visible:border-primary/40';

/** The gold primary button of the sign-in screens. */
export const AUTH_BUTTON =
  'gl-gold flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:cursor-not-allowed';

/**
 * The sign-in card: the brand panel and a form, two halves of one sheet. Every
 * screen somebody reaches before they can sign in uses it — signing in,
 * choosing a password from an emailed link, and asking for such a link.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12 sm:py-16">
      <div className="gl-auth-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
      <ConsoleRibbon />

      <div className="relative w-full max-w-5xl">
        {/* Two halves of one sheet: the brand panel and the form share a single
            rounded frame, and on the sign-in screen the round submit button
            sits on the seam. They stack under lg, where there is no seam. */}
        <div className="grid overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_1px_2px_hsl(224_47%_9%/0.06),0_44px_88px_-44px_hsl(224_47%_9%/0.45)] lg:grid-cols-2">
          <BrandPanel />
          {children}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is logged. Unauthorised use is prohibited.
        </p>
      </div>
    </main>
  );
}

/** The white half of the card, for the screens that have no seam button. */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-col justify-center bg-card px-7 py-10 sm:px-11 lg:px-14 lg:py-12">
      <div className="mx-auto w-full max-w-[22rem]">{children}</div>
    </div>
  );
}

/** The badge, title and line of explanation every auth screen opens with. */
export function AuthHeading({
  icon: Icon,
  badge,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  badge: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {badge}
      </span>
      <h1 className="mt-4 text-[28px] font-extrabold tracking-tight">{title}</h1>
      {children && <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
