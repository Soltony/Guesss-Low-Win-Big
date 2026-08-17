import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_PUBLIC_ROUTES,
  PERMISSION_EXEMPT_ROUTES,
  PROTECTED_MINIAPP_ROUTES,
  MINIAPP_PUBLIC_ROUTES,
  findAdminRoute,
  moduleKeyFor,
  moduleKeyForApiPath,
} from '@/lib/route-permissions';
import type { Permissions } from '@/lib/types';

export const config = {
  matcher: [
    '/',
    '/api/:path*',
    '/admin',
    '/admin/:path*',
    '/my-bids',
    '/my-bids/:path*',
    '/wins',
    '/wins/:path*',
    '/profile',
    '/profile/:path*',
  ],
};

const PROTECTED_ADMIN_PREFIXES = ['/admin', '/api/admin'];

// Mini-app APIs that need a bidder session.
const PROTECTED_MINIAPP_API = [
  '/api/miniapp/bids',
  '/api/miniapp/me',
  '/api/miniapp/favorites',
  '/api/miniapp/wins',
];

function securityHeaders(res: NextResponse, csp: string, nonce: string) {
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('x-nonce', nonce);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return res;
}

function isUnder(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(p + '/'));
}

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const nonce = btoa(crypto.randomUUID());

  // React's development build uses eval() for debugging features; the
  // production build never does. Allowing it in dev only keeps the shipped
  // policy strict while removing a permanent console error locally.
  const devEval = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval};
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com data:;
    img-src 'self' data: blob: https:;
    connect-src 'self';
    frame-ancestors *;
    media-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    worker-src 'self' blob:;
    manifest-src 'self';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Server Components cannot read the pathname directly; the admin layout uses
  // this to tell the bare auth screens apart from the shell routes.
  requestHeaders.set('x-pathname', path);
  const passthrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  const deny = (status: number, redirectTo: string) => {
    if (path.startsWith('/api/')) {
      return securityHeaders(
        NextResponse.json({ error: status === 401 ? 'Not authenticated' : 'Forbidden' }, { status }),
        csp,
        nonce
      );
    }
    return securityHeaders(
      NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin)),
      csp,
      nonce
    );
  };

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
    return securityHeaders(
      NextResponse.redirect(new URL('/admin/login', req.nextUrl.origin)),
      csp,
      nonce
    );
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
    return securityHeaders(passthrough(), csp, nonce);
  }
  if (ADMIN_PUBLIC_ROUTES.includes(path) || path.startsWith('/api/admin/auth')) {
    return securityHeaders(passthrough(), csp, nonce);
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

  if (session.passwordChangeRequired) {
    const allowed =
      path === '/admin/change-password' || path.startsWith('/api/admin/auth/change-password');
    if (!allowed) return deny(403, '/admin/change-password');
  } else if (path === '/admin/change-password') {
    return securityHeaders(
      NextResponse.redirect(new URL('/admin', req.nextUrl.origin)),
      csp,
      nonce
    );
  }

  if (PERMISSION_EXEMPT_ROUTES.includes(path)) {
    return securityHeaders(passthrough(), csp, nonce);
  }

  const isSuperAdmin = session.role === 'Super Admin';
  if (isSuperAdmin) return securityHeaders(passthrough(), csp, nonce);

  const permissions = session.permissions || {};
  const route = path.startsWith('/api/') ? undefined : findAdminRoute(path);
  const moduleKey = path.startsWith('/api/')
    ? moduleKeyForApiPath(path)
    : route
      ? moduleKeyFor(route.label)
      : undefined;

  // An admin page with no registry entry is not reachable by definition.
  if (!moduleKey) {
    if (path.startsWith('/api/')) return securityHeaders(passthrough(), csp, nonce);
    return deny(403, '/admin/no-access');
  }

  if (!permissions[moduleKey]?.read) return deny(403, '/admin/no-access');

  if (route?.roles?.length) {
    const allowed = route.roles.map((r) => r.toLowerCase());
    if (!session.role || !allowed.includes(session.role.toLowerCase())) {
      return deny(403, '/admin/no-access');
    }
  }

  return securityHeaders(passthrough(), csp, nonce);
}
