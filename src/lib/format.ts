import type { Prisma } from '@prisma/client';

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/** Prisma Decimal → number, at the serialization boundary only. */
export function toNum(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return Number(value.toString()) || 0;
}

export function money(value: DecimalLike, currency = 'ETB') {
  const n = toNum(value);
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function moneyShort(value: DecimalLike) {
  const n = toNum(value);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** Rounds to 2 decimals the way money should round, avoiding float drift. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-2)}`;
}

/** Normalizes Ethiopian numbers to the 251XXXXXXXXX form used as the bidder key. */
export function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('251')) return digits;
  if (digits.startsWith('0')) return `251${digits.slice(1)}`;
  if (digits.length === 9) return `251${digits}`;
  return digits;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  ended: boolean;
}

export function countdownFrom(endAt: Date | string, now: Date | number = Date.now()): Countdown {
  const end = new Date(endAt).getTime();
  const total = Math.max(0, end - new Date(now).getTime());
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    total,
    ended: total <= 0,
  };
}

export function formatCountdown(c: Countdown) {
  if (c.ended) return 'Ended';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${c.days}d : ${pad(c.hours)}h : ${pad(c.minutes)}m : ${pad(c.seconds)}s`;
}

export function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function firstImage(raw: string | null | undefined): string | null {
  return parseImages(raw)[0] ?? null;
}
