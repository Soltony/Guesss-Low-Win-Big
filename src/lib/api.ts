import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from './session';
import { hasPermission } from './permissions';
import type { PermissionAction, SessionUser } from './types';

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data as any, { status });
}

export function clientMeta(req: NextRequest) {
  return {
    ipAddress:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null,
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

/** Wraps a handler so unexpected throws become clean JSON instead of an HTML error page. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result as any);
  } catch (error: any) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    console.error('[api] unhandled error', error);
    return jsonError(error?.message || 'An unexpected error occurred.', 500);
  }
}

export function parsePaging(req: NextRequest, defaultSize = 20) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const rawSize = Number(url.searchParams.get('pageSize') ?? defaultSize) || defaultSize;
  const pageSize = Math.min(200, Math.max(1, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
