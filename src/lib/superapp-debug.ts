import { createHash, randomUUID } from 'crypto';

/**
 * Wire log for everything that crosses the super-app boundary.
 *
 * The gateway rejects a bad request with a single sentence — "Invalid data
 * signature." — and never says which field it disagreed on. This prints both
 * sides of every exchange (webview → us, us → super app, super app → us) with
 * enough detail to read the mismatch off the terminal instead of guessing:
 * exact values, their byte lengths, and the signature base string as hashed.
 *
 * Enabled outside production automatically; set SUPERAPP_DEBUG=true to turn it
 * on in a deployed test environment (or =false to silence it locally).
 *
 * Secrets are fingerprinted rather than printed. SUPERAPP_DEBUG_SECRETS=true
 * prints them in full — only ever point that at a test environment, never at a
 * deployment holding real customer tokens.
 */

/** Keys whose values are replaced by a fingerprint before printing. */
const SECRET_KEYS = [
  'token',
  'superapptoken',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'key',
  'paymentkey',
  'secret',
  'password',
  // A request's cookie header carries the whole session — the admin access and
  // refresh tokens, or the bidder's super-app token. Printing it verbatim into
  // a log hands over every session that log has ever seen.
  'cookie',
  'set-cookie',
  'x-cron-secret',
  'biddersession',
  'newpassword',
  'currentpassword',
  'signature',
];

/**
 * Debug logging is off in production, whatever the flag says.
 *
 * This log prints request bodies, header maps and gateway payloads, and the
 * same switch decides whether the gateway's own error text travels back to the
 * webview in an API response. A flag left on in a deployment is therefore an
 * information-disclosure channel rather than just noise — so production is the
 * one environment where it cannot be turned on by configuration.
 */
export function superAppDebugEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const flag = process.env.SUPERAPP_DEBUG;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return true;
}

/** Prints secrets in full rather than fingerprinting them. Never in production. */
export function superAppSecretsShown(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.SUPERAPP_DEBUG_SECRETS === 'true';
}

/** Short id that ties every line of one exchange together in the terminal. */
export function newTrace(): string {
  return randomUUID().slice(0, 8);
}

/**
 * A stand-in for a secret that is still comparable across log lines.
 *
 * The digest is the point: if the token fingerprinted at /connect differs from
 * the one fingerprinted when the fee is charged, the token was mangled in
 * between — by the query string, the cookie, or a copy-paste — and that alone
 * explains a rejected signature.
 */
export function fingerprint(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (!raw) return '<empty>';
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
  const body = superAppSecretsShown()
    ? raw
    : `${raw.slice(0, 6)}…${raw.length > 16 ? raw.slice(-4) : ''}`;
  return `${body} [len=${raw.length} sha256=${sha}]`;
}

/** `Bearer x` keeps its shape so the token inside stays comparable with a bare one. */
function fingerprintAuth(value: string): string {
  const match = /^Bearer\s+([\s\S]*)$/i.exec(value);
  return match ? `Bearer ${fingerprint(match[1])}` : fingerprint(value);
}

/**
 * A value with the details that decide a signature: its exact content, its
 * length, and the malformations that survive a glance — a stray space, or the
 * quotes an .env value keeps when it is written as KEY="value" and read by a
 * loader that does not strip them.
 */
export function describeValue(value: unknown, options: { secret?: boolean } = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const warnings: string[] = [];

  if (!raw) warnings.push('EMPTY');
  if (raw && raw !== raw.trim()) warnings.push('leading/trailing whitespace');
  if (/^(["']).*\1$/.test(raw)) warnings.push('wrapped in quotes — strip them from the .env value');

  return {
    value: options.secret && !superAppSecretsShown() ? fingerprint(raw) : raw,
    length: raw.length,
    ...(warnings.length ? { warnings } : {}),
  };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max depth]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (typeof entry === 'string' && lower === 'authorization') {
      out[key] = fingerprintAuth(entry);
    } else if (typeof entry === 'string' && SECRET_KEYS.includes(lower)) {
      out[key] = fingerprint(entry);
    } else {
      out[key] = redact(entry, depth + 1);
    }
  }
  return out;
}

/** Every header of a request or response, with the credentials fingerprinted. */
export function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    out[key] =
      lower === 'authorization'
        ? fingerprintAuth(value)
        : SECRET_KEYS.includes(lower)
          ? fingerprint(value)
          : value;
  });
  return out;
}

/**
 * One exchange, one block. `trace` is lifted into the header line so a whole
 * conversation can be pulled out of the terminal with a single grep.
 */
export function logSuperApp(event: string, data: Record<string, unknown> = {}) {
  if (!superAppDebugEnabled()) return;

  const { trace, ...rest } = data;
  const head = `[superapp] ${new Date().toISOString()} ${event}${trace ? `  trace=${trace}` : ''}`;

  let body = '';
  if (Object.keys(rest).length) {
    try {
      body = `\n${JSON.stringify(redact(rest), null, 2)}`;
    } catch {
      body = `\n${String(rest)}`;
    }
  }

  console.log(head + body);
}
