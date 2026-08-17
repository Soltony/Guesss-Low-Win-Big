import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAdminSession } from '@/lib/session';
import { verifyPassword } from '@/lib/admin-users';
import { createAuditLog } from '@/lib/audit-log';
import { getSettings } from '@/lib/settings';
import { clientMeta, enforceRateLimit, jsonError } from '@/lib/api';
import { RATE_LIMITS, reset as resetRateLimit } from '@/lib/rate-limit';
import { parsePermissions, firstAllowedPath } from '@/lib/permissions';
import { ADMIN_ROUTES, moduleKeyFor } from '@/lib/route-permissions';

export const dynamic = 'force-dynamic';

// Deliberately identical for "no such user" and "wrong password" so the login
// form cannot be used to enumerate valid accounts.
const GENERIC_FAILURE = 'Invalid email or password.';

export async function POST(req: NextRequest) {
  const meta = clientMeta(req);

  // Per-account lockout below stops one account being ground down. This stops
  // the other half of the same attack: one client spraying a common password
  // across many accounts, where no single account ever reaches its threshold.
  const limited = enforceRateLimit('admin-login', meta.ipAddress, RATE_LIMITS.adminLogin);
  if (limited) {
    await createAuditLog({
      actorId: 'ANONYMOUS',
      actorType: 'SYSTEM',
      action: 'LOGIN_RATE_LIMITED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return limited;
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!email || !password) return jsonError('Email and password are required.', 400);

  const settings = await getSettings();
  const maxAttempts = Number(settings['security.maxFailedLogins']) || 5;
  const lockoutMinutes = Number(settings['security.lockoutMinutes']) || 15;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  if (!user) {
    await createAuditLog({
      actorId: email,
      actorType: 'ADMIN',
      action: 'LOGIN_FAILED',
      details: { reason: 'Unknown email' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return jsonError(GENERIC_FAILURE, 401);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return jsonError(`Account locked. Try again in ${minutes} minute(s).`, 423);
  }

  if (user.status !== 'ACTIVE') {
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'LOGIN_BLOCKED',
      details: { reason: `Account status is ${user.status}` },
      ipAddress: meta.ipAddress,
    });
    return jsonError('This account is not active. Contact a system administrator.', 403);
  }

  const valid = await verifyPassword(password, user.password);

  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= maxAttempts;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      details: { attempt: failedCount, maxAttempts },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (shouldLock) {
      return jsonError(
        `Too many failed attempts. This account is locked for ${lockoutMinutes} minutes.`,
        423
      );
    }
    return jsonError(GENERIC_FAILURE, 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  // A proven-good sign-in clears the window, so a shared office address is not
  // rationed for everyone because one person mistyped their password earlier.
  resetRateLimit(`admin-login:${meta.ipAddress ?? 'unknown'}`);

  await createAdminSession(user.id, meta);

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'LOGIN_SUCCESS',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const permissions = parsePermissions(user.role.permissions);
  const landing = user.passwordChangeRequired
    ? '/admin/change-password'
    : firstAllowedPath(
        permissions,
        user.role.name,
        ADMIN_ROUTES.map((r) => ({ path: r.path, moduleKey: moduleKeyFor(r.label) }))
      );

  return NextResponse.json({
    ok: true,
    passwordChangeRequired: user.passwordChangeRequired,
    redirectTo: landing,
  });
}
