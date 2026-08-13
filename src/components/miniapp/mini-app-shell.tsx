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

/** Segmented control — clearer than a dropdown for exactly two languages. */
function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className="flex items-center rounded-full bg-white/10 p-0.5"
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
            'rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
            lang === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-white/70 hover:text-white'
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
    <header className="gl-ink sticky top-0 z-30">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="GuessLow home">
          <Logo className="h-8 w-8 text-black" />
          <span className="text-[17px] font-bold tracking-tight">
            Guess<span className="text-primary">Low</span>
          </span>
        </Link>

        <div className="flex-1" />

        <LanguageToggle />

        <Link
          href="/my-bids"
          className="gl-chip-dark hover:bg-white/20"
          aria-label={`${user?.activeBids ?? 0} active bids`}
        >
          <Gavel className="h-3.5 w-3.5" />
          <span className="tabular-nums">{user?.activeBids ?? 0}</span>
        </Link>

        <Link
          href="/profile"
          aria-label="Profile"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
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
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur">
      <div
        className="mx-auto grid w-full max-w-3xl grid-cols-5 px-1 pt-1.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.375rem)' }}
      >
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="flex flex-col items-center gap-1 py-1"
            >
              {/* The active item gets a filled gold tile — unmistakable at a
                  glance, and nothing reflows as you move between tabs. */}
              <span
                className={cn(
                  'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 1.8} />
              </span>
              <span
                className={cn(
                  'truncate text-[10px] transition-colors',
                  active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
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
            Test session — authorization bypassed, no fees charged
          </div>
        )}
        <TopBar user={user} />
        <main className="mx-auto w-full max-w-3xl flex-1 pb-24">{children}</main>
        <BottomNav />
      </div>
    </LanguageProvider>
  );
}
