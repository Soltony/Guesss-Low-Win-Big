import type { NextConfig } from 'next';
import { PERMISSIONS_POLICY, frameOptionsHeader } from './src/lib/security-headers';

/**
 * The single origin allowed to make credentialed cross-origin calls.
 *
 * `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin: *`
 * are a combination no browser honours, but a value that merely *looks* like a
 * wildcard — or an empty one that falls back to a default nobody checked — is
 * how an authenticated API ends up reachable from any page on the internet.
 * Resolved and validated at build time so a bad value fails the build instead
 * of shipping.
 */
function resolveAllowedOrigin(): string {
  const configured = (process.env.ALLOWED_ORIGIN || '').trim();
  if (!configured) return 'https://howlow.et';

  // Only the first entry is used for the static header; the proxy's same-origin
  // check reads the full list for request validation.
  const first = configured.split(',')[0].trim();

  if (first === '*' || first === 'null') {
    throw new Error(
      'ALLOWED_ORIGIN cannot be a wildcard while Access-Control-Allow-Credentials is enabled. ' +
        'Set it to the exact origin of the front end, e.g. https://guesslow.example.et'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(first);
  } catch {
    throw new Error(`ALLOWED_ORIGIN must be an absolute origin; received "${first}".`);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error(`ALLOWED_ORIGIN must use https (or be localhost); received "${first}".`);
  }

  return parsed.origin;
}

const baseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const frameOptions = frameOptionsHeader();

const nextConfig: NextConfig = {
  // Suppresses `X-Powered-By: Next.js`, which otherwise advertises the stack
  // and its likely version range to anyone who asks for a page.
  poweredByHeader: false,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co', pathname: '/**' },
      { protocol: 'https', hostname: 'play-lh.googleusercontent.com', pathname: '/**' },
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...baseSecurityHeaders,
          ...(frameOptions ? [{ key: 'X-Frame-Options', value: frameOptions }] : []),
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: resolveAllowedOrigin() },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
          },
          // Without this an intermediary cache can key one origin's response and
          // replay it to another, handing across whatever the first was allowed.
          { key: 'Vary', value: 'Origin' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      },
    ];
  },
};

export default nextConfig;
