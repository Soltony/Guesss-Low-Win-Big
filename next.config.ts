import type { NextConfig } from 'next';

/**
 * The single browser-facing origin allowed to call the API cross-origin.
 *
 * Credentialed CORS and `*` are mutually exclusive for a reason: a wildcard plus
 * cookies would let any site on the internet drive an authenticated session. The
 * browser would reject that pairing anyway, so a wildcard here is a
 * misconfiguration that silently breaks the app rather than a loose setting —
 * it is refused at build time instead.
 */
function allowedOrigin(): string {
  const configured = process.env.ALLOWED_ORIGIN?.trim();
  if (!configured) return 'https://howlow.et';

  if (configured === '*') {
    throw new Error(
      'ALLOWED_ORIGIN cannot be "*": the API sends credentials, and a wildcard origin ' +
        'would expose authenticated sessions to every site. Set it to the exact origin.'
    );
  }
  return configured;
}

/** Applied to every response, so no route can be reached without them. */
const BASE_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  // Keeps the framework out of the response headers, so a scan cannot read the
  // stack and version straight off a 404.
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
        headers: BASE_SECURITY_HEADERS,
      },
      {
        source: '/api/:path*',
        headers: [
          ...BASE_SECURITY_HEADERS,
          // API responses are per-session. Without this a shared cache — or the
          // browser's own back/forward store — can hand one user's data to the
          // next person on the device.
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin() },
          // The allowed origin is fixed rather than reflected, but caches still
          // need telling that the response varies by it.
          { key: 'Vary', value: 'Origin' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
