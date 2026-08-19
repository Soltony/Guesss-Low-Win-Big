/**
 * The response headers every route gets.
 *
 * Kept free of Node-only imports: the proxy runs on the Edge runtime and is the
 * one place that sees every response, which is exactly why the headers are
 * applied there rather than route by route.
 */

/**
 * Browser features this app never uses.
 *
 * Exhaustive rather than illustrative: `Permissions-Policy` denies only what it
 * names, so every capability left off the list stays available to any script
 * that manages to run — which is the situation the policy exists for.
 */
const DENIED_FEATURES = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'battery',
  'bluetooth',
  'camera',
  'display-capture',
  'document-domain',
  'encrypted-media',
  'execution-while-not-rendered',
  'execution-while-out-of-viewport',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'speaker-selection',
  'storage-access',
  'usb',
  'web-share',
  'xr-spatial-tracking',
];

export const PERMISSIONS_POLICY = DENIED_FEATURES.map((feature) => `${feature}=()`).join(', ');

/**
 * Where the console may be framed.
 *
 * `'none'` unless an operator deliberately embeds it: a clickjacked frame over
 * this admin surface can approve a payout or settle an auction with one
 * misdirected click, so the default has to be refusal rather than a wildcard.
 */
export function frameAncestors(): string {
  const configured = (process.env.FRAME_ANCESTORS || '').trim();
  if (!configured) return "'none'";
  return configured;
}

/** Whether the frame policy is permissive enough that `X-Frame-Options` must be dropped. */
export function frameOptionsHeader(): string | null {
  const ancestors = frameAncestors();
  if (ancestors === "'none'") return 'DENY';
  if (ancestors === "'self'") return 'SAMEORIGIN';
  // X-Frame-Options cannot express an allow-list; CSP frame-ancestors carries
  // it alone, and a contradictory legacy header would be the stricter of the two.
  return null;
}

export interface CspOptions {
  nonce: string;
  /** Development builds of React use eval(); the production build never does. */
  allowEval: boolean;
}

export function buildCsp({ nonce, allowEval }: CspOptions): string {
  const devEval = allowEval ? " 'unsafe-eval'" : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
    // 'unsafe-inline' is still required by the Tailwind/Radix layer, which
    // writes inline style attributes the server cannot nonce. Dropping it needs
    // a UI-layer refactor; the risk is style injection, not script execution.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Narrowed from `https:` to the hosts actually configured in
    // next.config.ts, so an injected tag cannot beacon out to any origin it
    // likes through an image request.
    "img-src 'self' data: blob: https://placehold.co https://play-lh.googleusercontent.com https://res.cloudinary.com",
    "connect-src 'self'",
    `frame-ancestors ${frameAncestors()}`,
    "frame-src 'none'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Applies the full header set to a response. */
export function applySecurityHeaders(headers: Headers, csp: string, nonce: string): Headers {
  headers.set('Content-Security-Policy', csp);
  headers.set('x-nonce', nonce);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  const frameOptions = frameOptionsHeader();
  if (frameOptions) headers.set('X-Frame-Options', frameOptions);

  // Browser isolation: keep this document out of other origins' browsing
  // context groups, and refuse to be loaded as a subresource elsewhere.
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  // Some hosting stacks add these downstream; overwriting with an empty-ish
  // value is the most this layer can do to avoid advertising the stack.
  headers.set('X-Powered-By', '');
  headers.delete('X-AspNet-Version');
  headers.delete('X-AspNetMvc-Version');

  return headers;
}

/** `true` for a path whose response must never be stored by a cache. */
export function isPrivatePath(path: string): boolean {
  if (path.startsWith('/api/')) return true;
  if (path.startsWith('/admin')) return true;
  return path === '/my-bids' || path === '/wins' || path === '/profile';
}

export const NO_STORE = 'no-store, no-cache, must-revalidate, private';
