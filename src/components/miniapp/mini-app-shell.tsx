'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Gavel, Globe, Home, Phone, Search, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LANGUAGES } from '@/lib/i18n';
import { LanguageProvider, useLanguage } from './language-provider';
import { Logo } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Language } from '@/lib/types';

export interface ShellUser {
  bidderId: string;
  phone: string;
  fullName: string | null;
  language: Language;
  activeBids: number;
}

function LanguagePicker() {
  const { lang, setLang } = useLanguage();
  const current = LANGUAGES.find((l) => l.value === lang) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-white/95 outline-none transition hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60">
        <Globe className="h-4 w-4" />
        <span>{current.short}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLang(l.value)}
            className={cn(lang === l.value && 'font-semibold text-primary')}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopBar({ user, supportPhone }: { user: ShellUser | null; supportPhone: string }) {
  return (
    <div className="howlow-hero sticky top-0 z-30">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <a
            href={`tel:${supportPhone}`}
            aria-label="Call support"
            className="rounded-full p-2 text-white transition hover:bg-white/15"
          >
            <Phone className="h-5 w-5" />
          </a>
          <LanguagePicker />
          <Link
            href="/my-bids"
            aria-label="Notifications"
            className="rounded-full p-2 text-white transition hover:bg-white/15"
          >
            <Bell className="h-5 w-5" />
          </Link>
        </div>

        <Link href="/" className="flex items-center gap-1.5 text-white" aria-label="HowLow home">
          <Logo className="h-6 w-6 text-white" />
          <span className="text-base font-bold tracking-tight">HowLow</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/my-bids"
            className="flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-primary shadow-sm transition hover:bg-white"
            aria-label={`${user?.activeBids ?? 0} active bids`}
          >
            <Gavel className="h-4 w-4" />
            {user?.activeBids ?? 0}
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm transition hover:bg-white"
          >
            <User className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </div>
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
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div
        className="mx-auto grid w-full max-w-3xl grid-cols-5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
              <span className="truncate">{t(item.label)}</span>
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
  supportPhone = '8080',
}: {
  children: React.ReactNode;
  user: ShellUser | null;
  supportPhone?: string;
}) {
  return (
    <LanguageProvider initialLang={user?.language ?? 'en'}>
      <div className="flex min-h-screen flex-col bg-background">
        <TopBar user={user} supportPhone={supportPhone} />
        <main className="mx-auto w-full max-w-3xl flex-1 pb-24">{children}</main>
        <BottomNav />
      </div>
    </LanguageProvider>
  );
}
