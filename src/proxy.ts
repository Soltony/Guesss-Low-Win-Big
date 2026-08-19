import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_PUBLIC_ROUTES,
  PERMISSION_EXEMPT_ROUTES,
  PROTECTED_MINIAPP_ROUTES,
  MINIAPP_PUBLIC_ROUTES,
  API_ROLE_CONSTRAINTS,
  findAdminRoute,
  isSelfGuardedAdminApi,
  moduleKeyFor,
  moduleKeyForApiPath,
} from '@/lib/route-permissions';
import { applySecurityHeaders, buildCsp, isPrivatePath, NO_STORE } from '@/lib/security-headers';
import { additionalTrustedOrigins, checkRequestOrigin } from '@/lib/request-context';
import type { Permissions } from '@/lib/types';

/**
 * Everything except immutable build output.
 *
 * Enumerating protected routes here is how public pages end up shipping with no
 * Content-Security-Policy at all — the mini-app browse pages render
 * operator-supplied auction content and were previously the least covered
 * routes on the site. Matching by exclusion means a route added later is
 * covered the day it is written; unguarded paths simply fall through to
 * `passthrough()` with the headers attached.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};

const PROTECTED_ADMIN_PREFIXES = ['/admin', '/api/admin'];

// Mini-app APIs that need a bidder session.
const PROTECTED_MINIAPP_API = [
  '/api/miniapp/bids',
  '/api/miniapp/me',
  '/api/miniapp/favorites',
  '/api/miniapp/wins',
];

/**
 * Endpoints called by something other than our own browser session, which
 * therefore cannot be expected to present a same-origin `Origin` header. Each
 * carries its own authentication: the gateway signs its callback and the
 * scheduler holds a shared secret, both verified in the handler.
 */
const ORIGIN_EXEMPT_PREFIXES = ['/api/payment/callback', '/api/cron'];

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isUnder(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(p + '/'));
}

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, allowEval: process.env.NODE_ENV !== 'production' });

  const finish = (res: NextResponse) => {
    applySecurityHeaders(res.headers, csp, nonce);

    // Per-session data must not survive in a shared cache or in the browser's
    // back/forward store, where the next person on the device would see it.
    // The root is included because it branches on the bidder cookie: cached
    // without regard to it, one visitor's landing page is served to the next.
    if (isPrivatePath(path) || path === '/') {
      res.headers.set('Cache-Control', NO_STORE);
      res.headers.set('Pragma', 'no-cache');
      res.headers.set('Expires', '0');
      // Origin, because CORS makes the response origin-dependent and an
      // intermediary could otherwise serve one origin's response to another.
      // Not applied to public assets: `Vary: Cookie` on an immutable image
      // would make a CDN cache it per session, which defeats the point.
      res.headers.set('Vary', 'Origin, Cookie');
    }
    return res;
  };

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Server Components cannot read the pathname directly; the admin layout uses
  // this to tell the bare auth screens apart from the shell routes.
  requestHeaders.set('x-pathname', path);
  const passthrough = () => NextResponse.next({ request: { headers: requestHeaders } });

  const deny = (status: number, redirectTo: string, message?: string) => {
    if (path.startsWith('/api/')) {
      const error = message ?? (status === 401 ? 'Not authenticated' : 'Forbidden');
      return finish(NextResponse.json({ error }, { status }));
    }
    return finish(NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin)));
  };

  // ----------------------------------------
  // CSRF: same-origin check on every state-changing request
  // ----------------------------------------
  // Applied ahead of routing so no handler can be added without it. SameSite
  // cookies are a browser-side control only — one non-conforming webview, or
  // one cookie whose attribute regresses, and cross-site forgery is open again.
  // This is the server-side half of that pair.
  if (STATE_CHANGING.has(req.method) && !isUnder(path, ORIGIN_EXEMPT_PREFIXES)) {
    const verdict = checkRequestOrigin(req.headers, req.nextUrl, additionalTrustedOrigins());
    if (verdict === 'cross-origin') {
      return deny(403, '/admin/login', 'Cross-origin request rejected.');
    }
  }

  // ----------------------------------------
  // ROOT: the front door is the admin login
  // ----------------------------------------
  // A super-app webview never lands on "/" cold — it enters at /connect, which
  // exchanges the super-app token for the bidder cookie and only then hands
  // control to the mini-app home. So a request for "/" that already carries
  // that cookie came through /connect and renders the mini-app; anything else
  // is a browser opening the site, which belongs on the admin login. Deep
  // mini-app routes are untouched and keep their own rules below.
  if (path === '/' && !req.cookies.get('bidderSession')?.value) {
    return finish(NextResponse.redirect(new URL('/admin/login', req.nextUrl.origin)));
  }

  // ----------------------------------------
  // MINI-APP: requires a super-app-issued bidder session
  // ----------------------------------------
  const isMiniAppPage = isUnder(path, PROTECTED_MINIAPP_ROUTES);
  const isMiniAppApi = isUnder(path, PROTECTED_MINIAPP_API);

  if ((isMiniAppPage || isMiniAppApi) && !MINIAPP_PUBLIC_ROUTES.includes(path)) {
    const cookie = req.cookies.get('bidderSession')?.value;
    if (!cookie) {
      const redirect = new URL('/connect', req.nextUrl.origin);
      redirect.searchParams.set('next', path);
      return deny(401, redirect.pathname + redirect.search);
    }
    // The cookie is signed; the route handlers verify the signature. Middleware
    // only checks presence so the Edge bundle stays free of crypto work.
  }

  // ----------------------------------------
  // ADMIN: session + module permission
  // ----------------------------------------
  if (!isUnder(path, PROTECTED_ADMIN_PREFIXES)) {
    return finish(passthrough());
  }
  if (ADMIN_PUBLIC_ROUTES.includes(path) || path.startsWith('/api/admin/auth')) {
    return finish(passthrough());
  }

  // The session endpoint owns token verification and refresh; middleware asks it
  // rather than duplicating Prisma and jose logic in the Edge runtime.
  let session: {
    authenticated?: boolean;
    role?: string;
    permissions?: Permissions;
    passwordChangeRequired?: boolean;
  } | null = null;

  try {
    const response = await fetch(new URL('/api/admin/auth/session', req.nextUrl.origin), {
      headers: {
        cookie: req.headers.get('cookie') || '',
        'x-auth-session-check': 'middleware',
      },
      cache: 'no-store',
    });
    if (response.ok) session = await response.json();
  } catch (error) {
    console.error('[middleware] session check failed', error);
    return deny(401, '/admin/login');
  }

  if (!session?.authenticated) return deny(401, '/admin/login');

  // A forced change pins the session to the change-password screen. Without one
  // the screen stays reachable: it is also how a signed-in admin changes their
  // own password voluntarily from the account menu.
  if (session.passwordChangeRequired) {
    const allowed =
      path === '/admin/change-password' || path.startsWith('/api/admin/auth/change-password');
    if (!allowed) return deny(403, '/admin/change-password');
  }

  if (PERMISSION_EXEMPT_ROUTES.includes(path)) {
    return finish(passthrough());
  }

  const isSuperAdmin = session.role === 'Super Admin';
  if (isSuperAdmin) return finish(passthrough());

  const permissions = session.permissions || {};
  const isApi = path.startsWith('/api/');

  // A handful of endpoints resolve their own authorization from a union of
  // module grants the proxy cannot express. They are named explicitly so the
  // deny-by-default below stays the rule rather than the exception.
  if (isApi && isSelfGuardedAdminApi(path)) return finish(passthrough());

  const route = isApi ? undefined : findAdminRoute(path);
  const moduleKey = isApi
    ? moduleKeyForApiPath(path)
    : route
      ? moduleKeyFor(route.label)
      : undefined;

  // Deny by default. An admin page with no registry entry is not reachable by
  // definition, and an admin API with no entry is one nobody has classified —
  // letting it through would mean every new endpoint ships unguarded until
  // somebody remembers to map it.
  if (!moduleKey) return deny(403, '/admin/no-access');

  if (!permissions[moduleKey]?.read) return deny(403, '/admin/no-access');

  // Role constraints are declared on the page for a UI route and in the API map
  // for an endpoint. Both are enforced: a page that only a Super Admin may open
  // must not have an API behind it that any module grant can call.
  const requiredRoles = isApi ? API_ROLE_CONSTRAINTS[moduleKey] : route?.roles;
  if (requiredRoles?.length) {
    const allowed = requiredRoles.map((r) => r.toLowerCase());
    if (!session.role || !allowed.includes(session.role.toLowerCase())) {
      return deny(403, '/admin/no-access');
    }
  }

  return finish(passthrough());
}
