/**
 * Fixed-window rate limiting for the endpoints an attacker hammers.
 *
 * Admin login already locks an *account* after N failures, which stops someone
 * grinding one password list against one inbox. It does nothing about the other
 * shape of the same attack: one client spraying one common password across many
 * accounts, where no single account ever reaches its threshold. Nor does it slow
 * a client replaying the unauthenticated endpoints — /api/auth/connect,
 * /api/payment/callback — which have no account to lock. That is what this adds.
 *
 * State is in-process, so the limits apply per server instance. On a single
 * instance this is exact; behind a load balancer with N instances the effective
 * ceiling is N times the configured one, which still bounds an attack by orders
 * of magnitude. Move the store to Redis when the app is scaled horizontally —
 * `check()` is the only function that would change.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Requests permitted inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — the value for the `Retry-After` header. */
  retryAfter: number;
}

const buckets = new Map<string, Window>();

/** Bounds memory: a spray across spoofed IPs must not grow the map without limit. */
const MAX_BUCKETS = 50_000;

function sweep(now: number) {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
  // Still oversized after dropping expired windows: an active flood. Start over
  // rather than let the map grow — the cost is one forgiven window.
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}

let lastSweep = 0;

/**
 * Records one hit against `key` and reports whether it is allowed.
 * Callers scope the key themselves (`login:1.2.3.4`) so two rules never collide.
 */
export function check(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  if (now - lastSweep > 60_000) {
    sweep(now);
    lastSweep = now;
  }

  const existing = buckets.get(key);
  const window =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };

  window.count += 1;
  buckets.set(key, window);

  const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  return {
    allowed: window.count <= rule.limit,
    remaining: Math.max(0, rule.limit - window.count),
    retryAfter,
  };
}

/** Clears a key early — called after a successful login so one typo costs nothing. */
export function reset(key: string) {
  buckets.delete(key);
}

/** Test hook. */
export function resetAll() {
  buckets.clear();
  lastSweep = 0;
}

/** The tuned rules, in one place so the limits are reviewable at a glance. */
export const RATE_LIMITS = {
  /** Admin sign-in, per source address, across all accounts. */
  adminLogin: { limit: 10, windowMs: 5 * 60_000 },
  /** Password change: authenticated, but still a password-guessing oracle. */
  passwordChange: { limit: 10, windowMs: 15 * 60_000 },
  /** Super-app token exchange. Generous — a webview may reconnect on resume. */
  connect: { limit: 30, windowMs: 5 * 60_000 },
  /** The test-login bypass, which creates bidder rows on demand. */
  testConnect: { limit: 10, windowMs: 5 * 60_000 },
  /** Bid placement, per bidder. Each one moves money, so bursts are suspicious. */
  placeBid: { limit: 20, windowMs: 60_000 },
  /** Gateway callback, per source address. Sized for legitimate retries. */
  paymentCallback: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;
