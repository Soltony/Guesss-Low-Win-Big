/**
 * Same-origin enforcement for state-changing requests (CSRF defence).
 *
 * Session cookies are `SameSite`, which already stops the classic cross-site
 * form post. That is one control though, and it is the browser's — an older
 * webview, a `SameSite=None` regression, or a request path that never touches
 * the browser's cookie policy would all silently remove it. Checking the
 * request's own origin costs nothing and does not depend on the client
 * cooperating, so the two together mean no single failure re-opens CSRF.
 *
 * Deliberately free of Node-only imports: the Edge middleware applies this
 * before a request ever reaches a route handler.
 */

/** Methods that cannot change state, and so need no origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Routes exempt from the check, because their caller is not a browser and has
 * its own authentication:
 *
 *   - the payment gateway callback — server-to-server, sends no Origin, and is
 *     authenticated by a bearer token plus a signed body;
 *   - the cron tick — authenticated by a shared secret header.
 *
 * Both are listed here rather than skipped ad hoc so the set of things allowed
 * to post cross-origin is one readable list.
 */
const EXEMPT_PREFIXES = ['/api/payment/callback', '/api/cron/'];

export function isOriginCheckExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/** Additional origins permitted to make state-changing calls, from the environment. */
function configuredOrigins(): string[] {
  return (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== '*');
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface OriginCheck {
  ok: boolean;
  /** Why it failed, for the audit trail. Undefined when it passed. */
  reason?: string;
}

/**
 * Verifies that a state-changing request came from this site.
 *
 * `Origin` is set by every browser on cross-site requests and cannot be forged
 * by page script. `Referer` is the fallback for the few contexts that omit
 * Origin. A request with neither is rejected: the browsers this app supports
 * always send at least one on a mutating request, so a request without them is
 * not the browser flow it claims to be.
 */
export function checkRequestOrigin(req: {
  method: string;
  headers: { get(name: string): string | null };
  nextUrl: { origin: string; pathname: string };
}): OriginCheck {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
  if (isOriginCheckExempt(req.nextUrl.pathname)) return { ok: true };

  const allowed = new Set([req.nextUrl.origin, ...configuredOrigins()]);

  const origin = originOf(req.headers.get('origin'));
  if (origin) {
    return allowed.has(origin)
      ? { ok: true }
      : { ok: false, reason: `Origin ${origin} is not allowed` };
  }

  const referer = originOf(req.headers.get('referer'));
  if (referer) {
    return allowed.has(referer)
      ? { ok: true }
      : { ok: false, reason: `Referer ${referer} is not allowed` };
  }

  return { ok: false, reason: 'Neither Origin nor Referer was supplied' };
}
