'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Gavel,
  Globe,
  Headphones,
  Loader2,
  LogOut,
  Receipt,
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

  const stats = [
    { label: 'Bids', value: profile.totalBids, icon: Gavel },
    { label: 'Auctions', value: profile.auctionsEntered, icon: Receipt },
    { label: 'Wins', value: profile.winsCount, icon: Trophy },
  ];

  return (
    <div className="pb-6">
      <div className="howlow-hero px-4 py-6 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
            <User className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-bold">
              {profile.fullName || 'HowLow bidder'}
            </p>
            <p className="text-sm opacity-90">{profile.phone}</p>
            <p className="mt-1 text-xs opacity-80">
              Member since {new Date(profile.memberSince).toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl bg-white/15 py-2">
              <Icon className="mx-auto h-4 w-4 opacity-90" />
              <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
              <p className="text-[11px] uppercase opacity-90">{label}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-center text-xs opacity-90">
          Service fees paid: <strong>{profile.totalSpent.toFixed(2)} Br</strong>
        </p>
      </div>

      {profile.status !== 'ACTIVE' && (
        <div className="mx-4 mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <Badge variant="destructive">{profile.status}</Badge>
          <p className="mt-1.5 text-muted-foreground">
            Your account cannot place bids right now. Contact support on {supportPhone}.
          </p>
        </div>
      )}

      <section className="mt-4 space-y-3 px-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <label htmlFor="fullName" className="text-sm font-semibold">
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
              className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={saving || name === (profile.fullName ?? '')}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4 text-primary" />
            Language
          </p>
          <div className="mt-2 flex gap-2">
            {LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLang(option.value)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition',
                  lang === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <Link
          href="/my-bids"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:bg-secondary/40"
        >
          <Gavel className="h-5 w-5 text-primary" />
          <span className="flex-1 text-sm font-semibold">{t('nav.myBids')}</span>
        </Link>

        <Link
          href="/wins"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:bg-secondary/40"
        >
          <Trophy className="h-5 w-5 text-accent" />
          <span className="flex-1 text-sm font-semibold">{t('wins.title')}</span>
        </Link>

        <a
          href={`tel:${supportPhone}`}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:bg-secondary/40"
        >
          <Headphones className="h-5 w-5 text-primary" />
          <span className="flex-1 text-sm font-semibold">Contact support</span>
          <span className="text-sm text-muted-foreground">{supportPhone}</span>
        </a>

        {terms && (
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {terms.title}
            </summary>
            <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {lang === 'am' && terms.contentAm ? terms.contentAm : terms.contentEn}
            </p>
          </details>
        )}

        <button
          type="button"
          onClick={disconnect}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition hover:bg-destructive/5"
        >
          <LogOut className="h-5 w-5 text-destructive" />
          <span className="flex-1 text-sm font-semibold text-destructive">Disconnect session</span>
        </button>
      </section>
    </div>
  );
}
