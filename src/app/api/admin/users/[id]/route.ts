import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { generateTempPassword, hashPassword, isValidEmail } from '@/lib/admin-users';
import { revokeAllUserSessions } from '@/lib/session';
import { SUPER_ADMIN_ROLE } from '@/lib/permissions';
import { normalizePhone } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('users', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user: actor } = guard;

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) return jsonError('User not found', 404);

  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const action = String(body?.action || 'update');

  if (action === 'reset-password') {
    // Self-reset is a lockout: the revoke below kills the actor's own session,
    // and the one-time password is only ever shown in the response dialog, so a
    // refresh mid-flow signs them out holding a password nobody has read.
    if (id === actor.id) {
      return jsonError('Use Change password to update your own password.', 409);
    }

    const tempPassword = generateTempPassword();
    await prisma.user.update({
      where: { id },
      data: {
        password: await hashPassword(tempPassword),
        passwordChangeRequired: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // Any live session keeps working otherwise, defeating the reset.
    await revokeAllUserSessions(id);

    await createAuditLog({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
      details: { email: target.email },
    });

    return NextResponse.json({ ok: true, tempPassword });
  }

  if (action === 'unlock') {
    await prisma.user.update({
      where: { id },
      data: { lockedUntil: null, failedLoginCount: 0 },
    });
    await createAuditLog({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'USER_UNLOCKED',
      entity: 'User',
      entityId: id,
      details: { email: target.email },
    });
    return NextResponse.json({ ok: true });
  }

  const data: Record<string, unknown> = {};

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) return jsonError('Full name cannot be empty.', 400);
    data.fullName = fullName;
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) return jsonError('Enter a valid email address.', 400);
    if (email !== target.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) return jsonError('An account with this email already exists.', 409);
      data.email = email;
    }
  }

  if (body.phoneNumber !== undefined) {
    const phoneNumber = normalizePhone(String(body.phoneNumber));
    if (!phoneNumber || phoneNumber.length < 9) return jsonError('Enter a valid phone number.', 400);
    if (phoneNumber !== target.phoneNumber) {
      const clash = await prisma.user.findUnique({ where: { phoneNumber } });
      if (clash) return jsonError('An account with this phone number already exists.', 409);
      data.phoneNumber = phoneNumber;
    }
  }

  if (body.roleId !== undefined && body.roleId !== target.roleId) {
    const role = await prisma.role.findUnique({ where: { id: String(body.roleId) } });
    if (!role) return jsonError('The selected role does not exist.', 404);

    // Removing the last Super Admin would lock everyone out of Access Control.
    if (target.role.name === SUPER_ADMIN_ROLE && role.name !== SUPER_ADMIN_ROLE) {
      const remaining = await prisma.user.count({
        where: { role: { name: SUPER_ADMIN_ROLE }, status: 'ACTIVE', NOT: { id } },
      });
      if (remaining === 0) {
        return jsonError('This is the last active Super Admin — assign another one first.', 409);
      }
    }
    data.roleId = role.id;
  }

  if (body.status !== undefined) {
    const status = String(body.status).toUpperCase();
    if (!['ACTIVE', 'SUSPENDED', 'DISABLED'].includes(status)) {
      return jsonError('Status must be ACTIVE, SUSPENDED or DISABLED.', 400);
    }
    // Checked before the self rule below: when both apply — the last Super
    // Admin disabling themselves — this is the one that says how to get
    // unstuck, and it is the constraint that holds for every actor rather than
    // only for this one.
    if (status !== 'ACTIVE' && target.role.name === SUPER_ADMIN_ROLE) {
      const remaining = await prisma.user.count({
        where: { role: { name: SUPER_ADMIN_ROLE }, status: 'ACTIVE', NOT: { id } },
      });
      if (remaining === 0) {
        return jsonError('This is the last active Super Admin and cannot be deactivated.', 409);
      }
    }
    if (status !== 'ACTIVE' && id === actor.id) {
      return jsonError('You cannot deactivate your own account.', 409);
    }
    data.status = status;
    if (status !== 'ACTIVE') await revokeAllUserSessions(id);
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  await prisma.user.update({ where: { id }, data });

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'USER_UPDATED',
    entity: 'User',
    entityId: id,
    details: { email: target.email, changed: Object.keys(data) },
  });

  return NextResponse.json({ ok: true });
}
