import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from './session';
import { hasPermission } from './permissions';
import { uuid } from './jwt';
import { check, type RateLimitRule } from './rate-limit';
import type { PermissionAction, SessionUser } from './types';

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data as any, { status });
}

/**
 * Whether `x-forwarded-for` can be believed.
 *
 * The header is client-supplied: anyone can set it to any value. Behind a proxy
 * that overwrites it, it is the only way to see the real client; served
 * directly, honouring it lets an attacker attribute their requests to an
 * arbitrary address — which would defeat every per-IP rate limit and poison the
 * audit trail. So it is trusted only where the deployment says a proxy exists.
 */
function trustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS === 'true';
}

export function clientIp(req: NextRequest): string | null {
  if (trustProxyHeaders()) {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const real = req.headers.get('x-real-ip')?.trim();
    if (real) return real;
  }
  // Next does not expose the socket address in every runtime; fall back to a
  // constant so a limiter keyed on this still degrades to a global cap rather
  // than to no limit at all.
  return null;
}

export function clientMeta(req: NextRequest) {
  return {
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  };
}

/**
 * Applies a rate-limit rule, returning a ready-to-send 429 when it is exceeded.
 * `scope` names the rule; `identity` is what it counts per — an address, or a
 * session id where one exists and is harder to rotate than an address.
 */
export function enforceRateLimit(
  scope: string,
  identity: string | null,
  rule: RateLimitRule
): NextResponse | null {
  const result = check(`${scope}:${identity ?? 'unknown'}`, rule);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
  );
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
 * error page.
 *
 * An unhandled exception's message is written by whatever threw it — Prisma
 * quotes the failing SQL and column names, `fetch` names the internal host it
 * could not reach. None of that is the caller's to see, so outside development
 * they get a reference id and the detail goes to the server log, where the two
 * can be matched up during support.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result as any);
  } catch (error: any) {
    // ApiError messages are written by us, for the caller, and are safe to send.
    if (error instanceof ApiError) return jsonError(error.message, error.status);

    const reference = uuid().slice(0, 8);
    console.error('[api] unhandled error', { reference, error });

    if (process.env.NODE_ENV !== 'production') {
      return jsonError(error?.message || 'An unexpected error occurred.', 500, { reference });
    }
    return jsonError(
      `An unexpected error occurred. Quote reference ${reference} if you contact support.`,
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
