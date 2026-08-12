'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gavel, Home, Search, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LANGUAGES } from '@/lib/i18n';
import { LanguageProvider, useLanguage } from './language-provider';
import { Logo } from '@/components/icons';
import type { Language } from '@/lib/types';

export interface ShellUser {
  bidderId: string;
  phone: string;
  fullName: string | null;
  language: Language;
  activeBids: number;
  /** Session was created through the authorization bypass. */
  isTest: boolean;
}

/** Two-state segmented control — clearer than a dropdown for exactly two languages. */
function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className="flex items-center rounded-md border border-border p-0.5"
      role="group"
      aria-label="Language"
    >
      {LANGUAGES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLang(option.value)}
          aria-pressed={lang === option.value}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            lang === option.value
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

function TopBar({ user }: { user: ShellUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="GuessLow home">
          <Logo className="h-7 w-7 text-foreground" />
          <span className="text-[15px] font-semibold tracking-tight">GuessLow</span>
        </Link>

        <div className="flex-1" />

        <LanguageToggle />

        <Link
          href="/my-bids"
          className="gl-pill hover:bg-secondary"
          aria-label={`${user?.activeBids ?? 0} active bids`}
        >
          <Gavel className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="tabular-nums">{user?.activeBids ?? 0}</span>
        </Link>

        <Link
          href="/profile"
          aria-label="Profile"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <User className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

const NAV = [
  { href: '/', label: 'nav.home', icon: Home },
  { href: '/auctions', label: 'nav.auctions', icon: Search },
  { href: '/my-bids', label: 'nav.myBids', icon: Gavel },
  { href: '/wins', label: 'nav.wins', icon: Trophy },
  { href: '/profile', label: 'nav.profile', icon: User },
] as const;

function BottomNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card">
      <div
        className="mx-auto grid w-full max-w-3xl grid-cols-5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="relative flex flex-col items-center gap-1 px-1 pb-2 pt-2.5"
            >
              {/* The active marker is a short rule above the icon, so the bar
                  stays quiet and nothing shifts as you navigate. */}
              <span
                className={cn(
                  'absolute inset-x-0 top-0 mx-auto h-0.5 w-8 rounded-full transition-colors',
                  active ? 'bg-primary' : 'bg-transparent'
                )}
              />
              <Icon
                className={cn(
                  'h-[18px] w-[18px] transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                strokeWidth={active ? 2.25 : 1.75}
              />
              <span
                className={cn(
                  'truncate text-[10px] font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {t(item.label)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MiniAppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: ShellUser | null;
}) {
  return (
    <LanguageProvider initialLang={user?.language ?? 'en'}>
      <div className="flex min-h-screen flex-col bg-background">
        {user?.isTest && (
          <div className="bg-accent px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">
            Test session — authorization bypassed, no fees are charged
          </div>
        )}
        <TopBar user={user} />
        <main className="mx-auto w-full max-w-3xl flex-1 pb-20">{children}</main>
        <BottomNav />
      </div>
    </LanguageProvider>
  );
}
