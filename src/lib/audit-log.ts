import prisma from './prisma';
import { uuid } from './jwt';

export interface AuditLogInput {
  actorId: string;
  actorName?: string | null;
  actorType?: 'ADMIN' | 'BIDDER' | 'SYSTEM' | 'EXTERNAL';
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string;
}

const REDACTED = '***REDACTED***';
const SENSITIVE_KEYS = [
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'superapptoken',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'signature',
  'key',
  'secret',
];

function truncate(value: string, maxLen = 8000) {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…(truncated, len=${value.length})`;
}

/** Recursively strips credentials so tokens never land in the audit table. */
export function sanitizeDetails(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeDetails(v, depth + 1));

  if (typeof value === 'object') {
    // Prisma Decimal and similar wrapper objects
    const anyVal = value as any;
    if (typeof anyVal.toNumber === 'function' && typeof anyVal.toFixed === 'function') {
      return Number(anyVal.toString());
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(anyVal)) {
      out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? REDACTED : sanitizeDetails(v, depth + 1);
    }
    return out;
  }

  return String(value);
}

export function newCorrelationId() {
  return uuid();
}

/** Audit writes must never break the operation being audited. */
export async function createAuditLog(input: AuditLogInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId || 'SYSTEM',
        actorName: input.actorName ?? undefined,
        actorType: input.actorType ?? 'ADMIN',
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details:
          input.details === undefined
            ? undefined
            : truncate(JSON.stringify(sanitizeDetails(input.details))),
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent?.slice(0, 1000) ?? undefined,
        correlationId: input.correlationId,
      },
    });
  } catch (error) {
    console.error('[audit] failed to write audit log', {
      action: input.action,
      entity: input.entity,
      error,
    });
  }
}

function sanitizeUrl(url: string) {
  try {
    const u = new URL(url);
    // Keep the shape of the query string but drop every value.
    const keys = Array.from(u.searchParams.keys());
    const query = keys.length ? `?${keys.map((k) => `${encodeURIComponent(k)}=`).join('&')}` : '';
    return `${u.origin}${u.pathname}${query}`;
  } catch {
    return truncate(String(url), 500);
  }
}

export async function auditExternalRequest(
  base: Omit<AuditLogInput, 'action' | 'details'> & { integration: string },
  request: { method: string; url: string; headers?: Record<string, string>; body?: unknown }
) {
  return createAuditLog({
    ...base,
    actorType: base.actorType ?? 'EXTERNAL',
    action: `EXTERNAL_${base.integration}_REQUEST`,
    details: {
      method: request.method,
      url: sanitizeUrl(request.url),
      headers: request.headers,
      body: request.body,
    },
  });
}

export async function auditExternalResponse(
  base: Omit<AuditLogInput, 'action' | 'details'> & { integration: string },
  response: { status?: number; body?: unknown; durationMs?: number }
) {
  return createAuditLog({
    ...base,
    actorType: base.actorType ?? 'EXTERNAL',
    action: `EXTERNAL_${base.integration}_RESPONSE`,
    details: {
      status: response.status,
      body: response.body,
      durationMs: response.durationMs,
    },
  });
}
