import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { BIDDER_STATUSES } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Moderates a bidder account: suspend, block, or restore. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('bidders', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const bidder = await prisma.bidder.findUnique({ where: { id } });
  if (!bidder) return jsonError('Bidder not found', 404);

  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const status = String(body?.status || '');
  const reason = String(body?.reason || '').trim();

  if (!BIDDER_STATUSES.includes(status as any)) {
    return jsonError(`Status must be one of: ${BIDDER_STATUSES.join(', ')}.`, 400);
  }
  if (status !== 'ACTIVE' && !reason) {
    return jsonError('A reason is required when suspending or blocking an account.', 400);
  }
  if (bidder.status === status) {
    return jsonError(`This account is already ${status.toLowerCase()}.`, 409);
  }

  await prisma.bidder.update({
    where: { id },
    data: {
      status,
      statusReason: status === 'ACTIVE' ? null : reason,
      moderatedById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'BIDDER_STATUS_CHANGED',
    entity: 'Bidder',
    entityId: id,
    details: { phone: bidder.phoneNumber, from: bidder.status, to: status, reason },
  });

  return NextResponse.json({ ok: true, status });
}
