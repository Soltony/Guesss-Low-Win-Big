import { describe, expect, it } from 'vitest';
import {
  accountLinkReport,
  accountLinkUrl,
  hashAccountToken,
  isLive,
  isWellFormedToken,
  linkAuditDetails,
  newAccountToken,
} from './account-links';

describe('newAccountToken', () => {
  it('is 32 random bytes in URL-safe base64, never repeated', () => {
    const tokens = Array.from({ length: 500 }, newAccountToken);

    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('hashAccountToken', () => {
  it('stores a SHA-256 digest, never the token itself', () => {
    const token = newAccountToken();
    const hash = hashAccountToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashAccountToken(token)).toBe(hash);
    expect(hashAccountToken(newAccountToken())).not.toBe(hash);
  });
});

describe('isWellFormedToken', () => {
  it('accepts exactly what newAccountToken produces', () => {
    expect(isWellFormedToken(newAccountToken())).toBe(true);
  });

  it('turns junk away before it reaches the database', () => {
    const token = newAccountToken();
    expect(isWellFormedToken('')).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken(42)).toBe(false);
    expect(isWellFormedToken(token.slice(1))).toBe(false);
    expect(isWellFormedToken(`${token}x`)).toBe(false);
    expect(isWellFormedToken(`${token.slice(1)}=`)).toBe(false);
    expect(isWellFormedToken(`${token.slice(1)}/`)).toBe(false);
    expect(isWellFormedToken(` ${token.slice(1)}`)).toBe(false);
  });
});

describe('accountLinkUrl', () => {
  const token = newAccountToken();

  it('puts the token in the fragment, which browsers never send to a server', () => {
    const url = new URL(accountLinkUrl('https://guesslow.example.et', token));

    expect(url.origin).toBe('https://guesslow.example.et');
    expect(url.pathname).toBe('/admin/set-password');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#token=${token}`);
  });

  it('builds on the configured console address, sub-path and trailing slash included', () => {
    expect(accountLinkUrl('https://example.et/guesslow/', token)).toBe(
      `https://example.et/guesslow/admin/set-password#token=${token}`
    );
  });
});

describe('isLive', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const live = {
    purpose: 'ACTIVATION',
    expiresAt: new Date('2026-10-09T13:00:00Z'),
    usedAt: null,
    user: { status: 'ACTIVE' },
  };

  it('accepts an unused, unexpired link for an active account', () => {
    expect(isLive(live, now)).toBe(true);
    expect(isLive({ ...live, purpose: 'PASSWORD_RESET' }, now)).toBe(true);
  });

  it('refuses a link that has been used, has lapsed, or whose account was switched off', () => {
    expect(isLive({ ...live, usedAt: new Date('2026-10-09T11:00:00Z') }, now)).toBe(false);
    expect(isLive({ ...live, expiresAt: now }, now)).toBe(false);
    expect(isLive({ ...live, expiresAt: new Date('2026-10-09T11:59:59Z') }, now)).toBe(false);
    expect(isLive({ ...live, user: { status: 'DISABLED' } }, now)).toBe(false);
    expect(isLive({ ...live, user: { status: 'SUSPENDED' } }, now)).toBe(false);
  });

  it('refuses a purpose it does not know', () => {
    expect(isLive({ ...live, purpose: 'LOGIN' }, now)).toBe(false);
  });
});

describe('what the screen and the audit trail are told', () => {
  const outcome = {
    purpose: 'ACTIVATION' as const,
    sent: false,
    expiresAt: new Date('2026-10-10T12:00:00Z'),
    error: 'The mail server rejected the username or password.',
  };

  it('masks the address and carries the reason, never a token', () => {
    const report = accountLinkReport(outcome, 'selam@example.com');

    expect(report).toEqual({
      purpose: 'ACTIVATION',
      sent: false,
      email: 'se***@example.com',
      expiresAt: '2026-10-10T12:00:00.000Z',
      savedTo: null,
      error: 'The mail server rejected the username or password.',
    });
  });

  it('records whether the link went and until when it works', () => {
    expect(linkAuditDetails({ ...outcome, sent: true, error: undefined, savedTo: 'C:\\mail\\x.eml' })).toEqual({
      link: 'ACTIVATION',
      linkSent: true,
      linkExpiresAt: '2026-10-10T12:00:00.000Z',
      linkSavedToTestFolder: true,
      linkError: null,
    });
  });
});
