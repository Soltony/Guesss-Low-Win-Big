import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { decideChange } from '@/lib/approvals';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const decision = String(body?.decision || '').toUpperCase();
  const comment = body?.comment ? String(body.comment).trim() : undefined;
  const { id } = await params;

  // Withdrawing your own request only needs update; deciding needs approve.
  if (decision === 'CANCELLED') {
    const guard = await requirePermission('approvals', 'update');
    if (isGuardFailure(guard)) return guard.response;
    const { user } = guard;

    const change = await prisma.pendingChange.findUnique({ where: { id } });
    if (!change) return jsonError('Change request not found', 404);
    if (change.createdById !== user.id) {
      return jsonError('Only the requester can withdraw this request.', 403);
    }
    if (change.status !== 'PENDING') {
      return jsonError(`This request was already ${change.status.toLowerCase()}.`, 409);
    }

    await prisma.pendingChange.update({
      where: { id },
      data: { status: 'CANCELLED', decidedAt: new Date(), comment },
    });

    // A withdrawn publish leaves the auction stuck in PENDING_APPROVAL.
    if (change.entityType === 'Auction' && change.action === 'PUBLISH' && change.entityId) {
      await prisma.auction
        .update({ where: { id: change.entityId }, data: { status: 'DRAFT' } })
        .catch(() => null);
    }

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'CHANGE_WITHDRAWN',
      entity: change.entityType,
      entityId: change.entityId ?? undefined,
      details: { changeId: id, comment },
    });

    return NextResponse.json({ ok: true, message: 'Request withdrawn.' });
  }

  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return jsonError('Decision must be APPROVED, REJECTED or CANCELLED.', 400);
  }
  if (decision === 'REJECTED' && !comment) {
    return jsonError('A comment is required when rejecting a request.', 400);
  }

  const guard = await requirePermission('approvals', 'approve');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const change = await prisma.pendingChange.findUnique({ where: { id } });

  // A rejected publish must not leave the auction stranded in PENDING_APPROVAL.
  const result = await decideChange(id, decision, user, comment);
  if (!result.ok) return jsonError(result.message, 409);

  if (
    decision === 'REJECTED' &&
    change?.entityType === 'Auction' &&
    change.action === 'PUBLISH' &&
    change.entityId
  ) {
    await prisma.auction
      .update({ where: { id: change.entityId }, data: { status: 'DRAFT' } })
      .catch(() => null);
  }

  return NextResponse.json({ ok: true, message: result.message });
}
