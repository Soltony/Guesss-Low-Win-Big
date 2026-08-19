import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from './session';
import { hasPermission } from './permissions';
import { clientAddress } from './request-context';
import { secureHex } from './random';
import { NO_STORE } from './security-headers';
import type { PermissionAction, SessionUser } from './types';

/**
 * Applied to every API response built here.
 *
 * API payloads are per-session by definition. Without an explicit directive a
 * shared cache or the browser's back/forward store may retain one and hand it
 * to whoever uses the device next.
 */
function withPrivacyHeaders(res: NextResponse) {
  res.headers.set('Cache-Control', NO_STORE);
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return withPrivacyHeaders(NextResponse.json({ error: message, ...extra }, { status }));
}

export function jsonOk<T>(data: T, status = 200) {
  return withPrivacyHeaders(NextResponse.json(data as any, { status }));
}

/**
 * Who sent this, as far as it can be trusted.
 *
 * `X-Forwarded-For` is client-supplied: honouring it unconditionally lets a
 * caller evade a per-address rate limit by varying the header, and lets them
 * write any address they like into the audit trail. `clientAddress` returns it
 * only where the deployment declares a proxy that overwrites it.
 */
export function clientMeta(req: NextRequest) {
  return {
    ipAddress: clientAddress(req.headers),
    userAgent: req.headers.get('user-agent'),
  };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Guards an admin API route. Returns the acting user, or a ready-to-return
 * error response. Middleware already gates the module, but routes re-check
 * the specific action because middleware cannot know create vs delete.
 */
export async function requirePermission(
  moduleKey: string,
  action: PermissionAction
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!user) return { response: jsonError('Not authenticated', 401) };
  if (user.passwordChangeRequired) {
    return { response: jsonError('Password change required', 403) };
  }
  if (!hasPermission(user, moduleKey, action)) {
    return {
      response: jsonError(`You do not have permission to ${action} ${moduleKey}.`, 403),
    };
  }
  return { user };
}

export function isGuardFailure(
  result: { user: SessionUser } | { response: NextResponse }
): result is { response: NextResponse } {
  return 'response' in result;
}

/**
 * Wraps a handler so unexpected throws become clean JSON instead of an HTML
 * error page — and, in production, instead of a description of our internals.
 *
 * A raw exception message here is a disclosure channel: Prisma names the query
 * and the column it failed on, a failed `fetch` names the internal host it
 * could not reach, and a stack-adjacent message names the file. `ApiError` is
 * deliberately authored for the caller and passes through unchanged; anything
 * else is replaced by a generic sentence carrying a correlation reference, and
 * the full detail is logged against that reference server-side.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return withPrivacyHeaders(result);
    return withPrivacyHeaders(NextResponse.json(result as any));
  } catch (error: any) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);

    const reference = secureHex(8);
    console.error(`[api] unhandled error ref=${reference}`, error);

    if (process.env.NODE_ENV !== 'production') {
      return jsonError(error?.message || 'An unexpected error occurred.', 500, { reference });
    }
    return jsonError(
      'An unexpected error occurred. Quote the reference below if you report this.',
      500,
      { reference }
    );
  }
}

export function parsePaging(req: NextRequest, defaultSize = 20) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const rawSize = Number(url.searchParams.get('pageSize') ?? defaultSize) || defaultSize;
  const pageSize = Math.min(200, Math.max(1, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Reads a JSON body, refusing anything implausibly large.
 *
 * The runtime will happily buffer a multi-megabyte body into memory before a
 * handler ever looks at it, which is a cheap way to tie up a server. Routes
 * here exchange small objects, so a tight ceiling costs nothing.
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

export async function readJsonBody<T = any>(
  req: NextRequest,
  maxBytes = MAX_JSON_BODY_BYTES
): Promise<T | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const text = await req.text().catch(() => '');
  if (text.length > maxBytes) return null;
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/** A ready-to-return 429 with the standard `Retry-After` header. */
export function tooManyRequests(retryAfterSeconds: number, message?: string) {
  const res = jsonError(
    message ?? 'Too many requests. Please wait a moment and try again.',
    429
  );
  res.headers.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return res;
}
