import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('notifications', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const template = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!template) return jsonError('Template not found', 404);

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.subject !== undefined) data.subject = String(body.subject) || null;
  if (body.bodyEn !== undefined) {
    const bodyEn = String(body.bodyEn).trim();
    if (!bodyEn) return jsonError('English message body cannot be empty.', 400);
    data.bodyEn = bodyEn;
  }
  if (body.bodyAm !== undefined) data.bodyAm = String(body.bodyAm) || null;
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.channel !== undefined) {
    const channel = String(body.channel).toUpperCase();
    if (!['SMS', 'PUSH', 'INAPP'].includes(channel)) {
      return jsonError('Channel must be SMS, PUSH or INAPP.', 400);
    }
    data.channel = channel;
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  await prisma.notificationTemplate.update({ where: { id }, data });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'NOTIFICATION_TEMPLATE_UPDATED',
    entity: 'NotificationTemplate',
    entityId: id,
    details: { code: template.code, changed: Object.keys(data) },
  });

  return NextResponse.json({ ok: true });
}
