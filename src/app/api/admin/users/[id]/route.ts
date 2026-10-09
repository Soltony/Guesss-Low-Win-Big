import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { isValidEmail } from '@/lib/admin-users';
import { revokeAllUserSessions } from '@/lib/session';
import { SUPER_ADMIN_ROLE } from '@/lib/permissions';
import { parseEthiopianMobile } from '@/lib/format';
import {
  accountLinkReport,
  linkAuditDetails,
  sendAccountLink,
  type AccountLinkPurpose,
} from '@/lib/account-links';

export const dynamic = 'force-dynamic';

const PHONE_ERROR = 'Enter a valid Ethiopian mobile number, such as 0912345678.';

/**
 * Super Admins, other than this one, who could sign in right now. An invited
 * account that has not set its password yet is ACTIVE but cannot, so it is
 * not somebody to leave Access Control with.
 */
function otherUsableSuperAdmins(id: string) {
  return prisma.user.count({
    where: {
      role: { name: SUPER_ADMIN_ROLE },
      status: 'ACTIVE',
      password: { not: null },
      NOT: { id },
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('users', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user: actor } = guard;

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) return jsonError('User not found', 404);

  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;
  const action = String(body?.action || 'update');

  if (action === 'reset-password') {
    // Self-reset is a lockout: the revoke below kills the actor's own session,
    // and the link to choose a new password goes to the account's mailbox, not
    // to this screen.
    if (id === actor.id) {
      return jsonError('Use Change password to update your own password.', 409);
    }
    if (target.status !== 'ACTIVE') {
      return jsonError('Enable the account before resetting its password.', 409);
    }
    if (!target.password) {
      return jsonError('This account has no password yet. Send its link again instead.', 409);
    }

    // A reset assumes the password may be known to someone else: it stops
    // working now, every session is signed out, and the holder chooses a new
    // one through the link emailed below.
    await prisma.user.update({
      where: { id },
      data: { password: null, passwordChangeRequired: false, failedLoginCount: 0, lockedUntil: null },
    });
    await revokeAllUserSessions(id);

    const link = await sendAccountLink(target, 'PASSWORD_RESET', { issuedById: actor.id });

    await createAuditLog({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
      details: { email: target.email, ...linkAuditDetails(link) },
    });

    return NextResponse.json({ ok: true, link: accountLinkReport(link, target.email) });
  }

  if (action === 'resend-link') {
    if (target.password) {
      return jsonError('This account already has a password. Use Reset password instead.', 409);
    }
    if (target.status !== 'ACTIVE') {
      return jsonError('Enable the account before sending it a link.', 409);
    }

    // Whatever the account is waiting on — its invitation, or the reset an
    // administrator started — is what it is sent again.
    const last = await prisma.accountToken.findFirst({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      select: { purpose: true },
    });
    const purpose: AccountLinkPurpose =
      last?.purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'ACTIVATION';

    const link = await sendAccountLink(target, purpose, { issuedById: actor.id });

    await createAuditLog({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'ACCOUNT_LINK_RESENT',
      entity: 'User',
      entityId: id,
      details: { email: target.email, ...linkAuditDetails(link) },
    });

    return NextResponse.json({ ok: true, link: accountLinkReport(link, target.email) });
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
    if (!fullName) return jsonError('Full name cannot be empty.', 400, { field: 'fullName' });
    data.fullName = fullName;
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) {
      return jsonError('Enter a valid email address.', 400, { field: 'email' });
    }
    if (email !== target.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) {
        return jsonError('An account with this email already exists.', 409, { field: 'email' });
      }
      data.email = email;
    }
  }

  if (body.phoneNumber !== undefined) {
    const phoneNumber = parseEthiopianMobile(String(body.phoneNumber));
    if (!phoneNumber) {
      return jsonError(PHONE_ERROR, 400, { field: 'phoneNumber' });
    }
    if (phoneNumber !== target.phoneNumber) {
      const clash = await prisma.user.findUnique({ where: { phoneNumber } });
      if (clash) {
        return jsonError('An account with this phone number already exists.', 409, {
          field: 'phoneNumber',
        });
      }
      data.phoneNumber = phoneNumber;
    }
  }

  if (body.roleId !== undefined && body.roleId !== target.roleId) {
    const role = await prisma.role.findUnique({ where: { id: String(body.roleId) } });
    if (!role) return jsonError('The selected role does not exist.', 404, { field: 'roleId' });

    // Removing the last Super Admin would lock everyone out of Access Control.
    if (target.role.name === SUPER_ADMIN_ROLE && role.name !== SUPER_ADMIN_ROLE) {
      const remaining = await otherUsableSuperAdmins(id);
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
      const remaining = await otherUsableSuperAdmins(id);
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

  // A link already emailed went to the old address, or belongs to an account
  // that can no longer use it. Either way it stops working now. It is expired
  // rather than deleted, so a later resend still knows what it was for.
  let linkWithdrawn = false;
  if (data.email || (data.status && data.status !== 'ACTIVE')) {
    const { count } = await prisma.accountToken.updateMany({
      where: { userId: id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    linkWithdrawn = count > 0;
  }

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'USER_UPDATED',
    entity: 'User',
    entityId: id,
    details: { email: target.email, changed: Object.keys(data), linkWithdrawn },
  });

  return NextResponse.json({ ok: true, linkWithdrawn });
}
