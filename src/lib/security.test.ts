import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS, check, reset, resetAll } from './rate-limit';
import { checkRequestOrigin, isOriginCheckExempt } from './request-origin';
import { generateTempPassword, validatePassword } from './admin-users';
import { secureRandomInt, uuid } from './jwt';
import { safeEqualHex } from './payment-gateway';

/** Minimal stand-in for the parts of NextRequest the origin check reads. */
function request(options: {
  method: string;
  path?: string;
  origin?: string;
  referer?: string;
  siteOrigin?: string;
}) {
  const headers = new Map<string, string>();
  if (options.origin) headers.set('origin', options.origin);
  if (options.referer) headers.set('referer', options.referer);

  return {
    method: options.method,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    nextUrl: {
      origin: options.siteOrigin ?? 'https://guesslow.example.et',
      pathname: options.path ?? '/api/admin/users',
    },
  };
}

describe('rate limiting', () => {
  beforeEach(() => resetAll());

  it('allows requests up to the limit and blocks the next one', () => {
    const rule = { limit: 3, windowMs: 60_000 };
    expect(check('k', rule).allowed).toBe(true);
    expect(check('k', rule).allowed).toBe(true);
    expect(check('k', rule).allowed).toBe(true);
    expect(check('k', rule).allowed).toBe(false);
  });

  it('counts each key independently, so one caller cannot lock out another', () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(check('ip-a', rule).allowed).toBe(true);
    expect(check('ip-a', rule).allowed).toBe(false);
    expect(check('ip-b', rule).allowed).toBe(true);
  });

  it('reports a positive retry-after once blocked', () => {
    const rule = { limit: 1, windowMs: 60_000 };
    check('k', rule);
    const blocked = check('k', rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('forgives the window on reset, as a successful login does', () => {
    const rule = { limit: 1, windowMs: 60_000 };
    check('k', rule);
    expect(check('k', rule).allowed).toBe(false);
    reset('k');
    expect(check('k', rule).allowed).toBe(true);
  });

  it('starts a fresh window once the old one has elapsed', () => {
    const rule = { limit: 1, windowMs: 1 };
    expect(check('k', rule).allowed).toBe(true);
    const later = Date.now() + 10;
    while (Date.now() < later) {
      /* spin briefly so the 1ms window closes */
    }
    expect(check('k', rule).allowed).toBe(true);
  });

  it('keeps every configured rule finite and positive', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowMs, name).toBeGreaterThan(0);
    }
  });
});

describe('request origin (CSRF)', () => {
  it('lets safe methods through without an origin', () => {
    expect(checkRequestOrigin(request({ method: 'GET' })).ok).toBe(true);
    expect(checkRequestOrigin(request({ method: 'HEAD' })).ok).toBe(true);
    expect(checkRequestOrigin(request({ method: 'OPTIONS' })).ok).toBe(true);
  });

  it('accepts a same-origin state-changing request', () => {
    const result = checkRequestOrigin(
      request({ method: 'POST', origin: 'https://guesslow.example.et' })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a cross-site POST — the classic CSRF shape', () => {
    const result = checkRequestOrigin(request({ method: 'POST', origin: 'https://evil.example' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('evil.example');
  });

  it('rejects an origin that merely starts with the real one', () => {
    const result = checkRequestOrigin(
      request({ method: 'POST', origin: 'https://guesslow.example.et.evil.example' })
    );
    expect(result.ok).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(
      checkRequestOrigin(
        request({ method: 'POST', referer: 'https://guesslow.example.et/admin/users' })
      ).ok
    ).toBe(true);

    expect(
      checkRequestOrigin(request({ method: 'POST', referer: 'https://evil.example/x' })).ok
    ).toBe(false);
  });

  it('rejects a mutating request carrying neither header', () => {
    const result = checkRequestOrigin(request({ method: 'POST' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/neither/i);
  });

  it('exempts only the machine-to-machine endpoints', () => {
    expect(isOriginCheckExempt('/api/payment/callback')).toBe(true);
    expect(isOriginCheckExempt('/api/cron/tick')).toBe(true);
    expect(isOriginCheckExempt('/api/admin/users')).toBe(false);
    expect(isOriginCheckExempt('/api/miniapp/bids')).toBe(false);
  });

  it('lets the gateway callback through without an origin', () => {
    expect(
      checkRequestOrigin(request({ method: 'POST', path: '/api/payment/callback' })).ok
    ).toBe(true);
  });
});

describe('password policy', () => {
  it('requires length and all four character classes', () => {
    expect(validatePassword('Sh0rt!').ok).toBe(false);
    expect(validatePassword('alllowercase1!').ok).toBe(false);
    expect(validatePassword('ALLUPPERCASE1!').ok).toBe(false);
    expect(validatePassword('NoDigitsHere!').ok).toBe(false);
    expect(validatePassword('NoSymbolsHere1').ok).toBe(false);
  });

  it('accepts a strong password', () => {
    expect(validatePassword('Vh7#kQpm2Lz!').ok).toBe(true);
  });

  it('rejects common passwords that would otherwise pass the classes', () => {
    expect(validatePassword('Password1!').ok).toBe(false);
    expect(validatePassword('Admin@1234').ok).toBe(false);
    expect(validatePassword('Welcome@123').ok).toBe(false);
  });

  it('rejects repeated characters and keyboard runs', () => {
    expect(validatePassword('Aaaa1234!xyz').ok).toBe(false);
    expect(validatePassword('Qwerty12345!').ok).toBe(false);
  });

  it('rejects an over-long password, so bcrypt is never handed unbounded input', () => {
    expect(validatePassword(`A1!a${'x'.repeat(200)}`).ok).toBe(false);
  });
});

describe('generated temporary passwords', () => {
  it('always satisfies the policy it will be checked against', () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generateTempPassword();
      const result = validatePassword(password);
      expect(result.ok, `${password} -> ${result.ok ? '' : result.error}`).toBe(true);
    }
  });

  it('does not repeat across draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()));
    expect(seen.size).toBe(500);
  });
});

describe('secure randomness', () => {
  it('stays inside the requested range', () => {
    for (let i = 0; i < 1000; i += 1) {
      const value = secureRandomInt(10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
  });

  it('covers the whole range rather than collapsing to a few values', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => secureRandomInt(16)));
    expect(seen.size).toBe(16);
  });

  it('refuses a non-positive bound instead of returning a constant', () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(-1)).toThrow();
    expect(() => secureRandomInt(1.5)).toThrow();
  });

  it('produces unique, well-formed uuids', () => {
    const ids = Array.from({ length: 1000 }, () => uuid());
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids.slice(0, 50)) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

describe('constant-time digest comparison', () => {
  it('matches identical values, case-insensitively', () => {
    expect(safeEqualHex('abc123', 'abc123')).toBe(true);
    expect(safeEqualHex('ABC123', 'abc123')).toBe(true);
  });

  it('rejects differing values, including a shared prefix', () => {
    expect(safeEqualHex('abc123', 'abc124')).toBe(false);
    expect(safeEqualHex('abc', 'abc123')).toBe(false);
  });

  it('treats a missing value as a mismatch rather than a pass', () => {
    expect(safeEqualHex(null, 'abc')).toBe(false);
    expect(safeEqualHex('abc', null)).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex(undefined, undefined)).toBe(false);
  });
});
