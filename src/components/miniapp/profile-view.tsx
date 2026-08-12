'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  Gavel,
  Headphones,
  Loader2,
  LogOut,
  ShieldCheck,
  Trophy,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from './language-provider';
import { LANGUAGES } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import type { Language } from '@/lib/types';

interface Profile {
  phone: string;
  fullName: string | null;
  language: Language;
  status: string;
  totalBids: number;
  totalSpent: number;
  winsCount: number;
  auctionsEntered: number;
  memberSince: string;
}

export function ProfileView({
  profile,
  supportPhone,
  terms,
}: {
  profile: Profile;
  supportPhone: string;
  terms: { title: string; contentEn: string; contentAm: string | null } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, lang, setLang } = useLanguage();
  const [name, setName] = useState(profile.fullName ?? '');
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/miniapp/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: name }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ variant: 'destructive', title: 'Not saved', description: data?.error });
        return;
      }
      toast({ title: 'Profile updated' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    await fetch('/api/miniapp/me', { method: 'DELETE' }).catch(() => null);
    router.replace('/');
    router.refresh();
  };

  return (
    <div className="pb-8">
      {/* Identity */}
      <div className="border-b border-border bg-card px-4 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary">
            <User className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-tight">
              {profile.fullName || 'GuessLow bidder'}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{profile.phone}</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
          {[
            { label: 'Bids', value: profile.totalBids },
            { label: 'Auctions', value: profile.auctionsEntered },
            { label: 'Wins', value: profile.winsCount },
          ].map((stat) => (
            <div key={stat.label} className="bg-card px-3 py-2.5 text-center">
              <dd className="text-base font-semibold tabular-nums leading-none">{stat.value}</dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">{stat.label}</dt>
            </div>
          ))}
        </dl>

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {profile.totalSpent.toFixed(2)} Br in service fees · member since{' '}
          {new Date(profile.memberSince).toLocaleDateString('en-GB')}
        </p>
      </div>

      {profile.status !== 'ACTIVE' && (
        <div className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <Badge variant="destructive">{profile.status}</Badge>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your account cannot place bids right now. Contact support on {supportPhone}.
          </p>
        </div>
      )}

      <div className="space-y-3 px-4 pt-4">
        {/* Display name */}
        <div className="gl-panel p-4">
          <label htmlFor="fullName" className="text-sm font-medium">
            Display name
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            Shown on the winners board when you win.
          </p>
          <div className="flex gap-2">
            <input
              id="fullName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={saving || name === (profile.fullName ?? '')}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="gl-panel p-4">
          <p className="text-sm font-medium">Language</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLang(option.value)}
                aria-pressed={lang === option.value}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  lang === option.value
                    ? 'border-foreground/30 bg-secondary text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Links */}
        <nav className="gl-panel divide-y divide-border">
          {[
            { href: '/my-bids', label: t('nav.myBids'), icon: Gavel },
            { href: '/wins', label: t('wins.title'), icon: Trophy },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}

          <a
            href={`tel:${supportPhone}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
          >
            <Headphones className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-1 text-sm font-medium">Contact support</span>
            <span className="text-sm text-muted-foreground">{supportPhone}</span>
          </a>
        </nav>

        {terms && (
          <details className="gl-panel group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1">{terms.title}</span>
              <span className="text-muted-foreground transition-transform group-open:rotate-180">
                ⌄
              </span>
            </summary>
            <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {lang === 'am' && terms.contentAm ? terms.contentAm : terms.contentEn}
            </p>
          </details>
        )}

        <button
          type="button"
          onClick={disconnect}
          className="gl-panel flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
        >
          <LogOut className="h-4 w-4 text-destructive" strokeWidth={1.75} />
          <span className="flex-1 text-sm font-medium text-destructive">Disconnect session</span>
        </button>
      </div>
    </div>
  );
}
