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

/**
 * Rendered wherever a bid amount is withheld. Lives here rather than beside the
 * disclosure rules in bid-visibility.ts so client components can show a masked
 * cell without pulling the decryption module into the browser bundle.
 */
export const MASKED_AMOUNT = '•••';

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-2)}`;
}

/**
 * A normalized Ethiopian number: the 251 country code and exactly nine more
 * digits. Anything shorter is truncated, anything longer is two numbers that
 * ran together or a country code repeated - neither can be dialled, and
 * neither should be stored as if it could.
 */
export function isValidEthiopianPhone(normalized: string): boolean {
  return /^251[0-9]{9}$/.test(normalized);
}

/**
 * Narrower still: a line an SMS can actually reach. Ethiopian mobile ranges
 * open 09 (Ethio Telecom) or 07 (Safaricom); everything else in the numbering
 * plan is a landline. Anywhere a number is the only way to reach a person -
 * an admin receiving a one-time password, for instance - a landline is not a
 * usable answer.
 */
export function isEthiopianMobile(normalized: string): boolean {
  return /^251[79][0-9]{8}$/.test(normalized);
}

/** Normalizes Ethiopian numbers to the 251XXXXXXXXX form used as the bidder key. */
export function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('251')) return digits;
  if (digits.startsWith('0')) return `251${digits.slice(1)}`;
  if (digits.length === 9) return `251${digits}`;
  return digits;
}

/**
 * The 251XXXXXXXXX form back to the 0XXXXXXXXX one the SMS gateway addresses
 * subscribers by. Storage keeps the country code - it is the bidder key, and
 * the only form that reads the same whatever wrote it - so the local form is
 * produced at the transport boundary and nowhere else.
 *
 * A number that is not Ethiopian is handed on untouched rather than guessed
 * at: dropping a leading 251 that is not a country code would misdial it.
 */
export function toLocalPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (!isValidEthiopianPhone(normalized)) return String(raw || '').trim();
  return `0${normalized.slice(3)}`;
}

/**
 * Rejects an entry that is not written as a phone number at all.
 *
 * normalizePhone throws away every non-digit, which quietly turns
 * "0912345678abc" into a well-formed number and stores it as if the operator
 * had typed one. Text mixed into the field is a mistake to be reported, not
 * one to be silently repaired.
 */
export function looksLikePhoneNumber(raw: string): boolean {
  return /^[+]?[0-9 ()-]+$/.test(raw.trim());
}

/**
 * A raw entry read as an Ethiopian mobile number, or null if it is not one.
 * The single gate for anywhere a person is reached by SMS.
 */
export function parseEthiopianMobile(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed || !looksLikePhoneNumber(trimmed)) return null;
  const normalized = normalizePhone(trimmed);
  return isEthiopianMobile(normalized) ? normalized : null;
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
