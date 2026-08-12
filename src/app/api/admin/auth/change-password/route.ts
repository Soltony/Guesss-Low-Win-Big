import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser, revokeAllUserSessions, createAdminSession } from '@/lib/session';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/admin-users';
import { createAuditLog } from '@/lib/audit-log';
import { clientMeta, jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!user) return jsonError('Not authenticated', 401);

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  const confirmPassword = String(body?.confirmPassword || '');

  if (!currentPassword || !newPassword) {
    return jsonError('Current and new passwords are required.', 400);
  }
  if (newPassword !== confirmPassword) {
    return jsonError('The new passwords do not match.', 400);
  }
  if (newPassword === currentPassword) {
    return jsonError('The new password must be different from the current one.', 400);
  }

  const policy = validatePassword(newPassword);
  if (!policy.ok) return jsonError(policy.error, 400);

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record) return jsonError('User not found', 404);

  const valid = await verifyPassword(currentPassword, record.password);
  if (!valid) {
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'PASSWORD_CHANGE_FAILED',
      ...clientMeta(req),
    });
    return jsonError('Your current password is incorrect.', 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword), passwordChangeRequired: false },
  });

  // Every other session is invalidated, then this client gets a fresh one.
  await revokeAllUserSessions(user.id);
  await createAdminSession(user.id, clientMeta(req));

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'PASSWORD_CHANGED',
    ...clientMeta(req),
  });

  return NextResponse.json({ ok: true, redirectTo: '/admin' });
}
