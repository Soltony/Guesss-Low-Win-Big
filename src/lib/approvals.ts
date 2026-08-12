import prisma from './prisma';
import { getSettings, setSetting } from './settings';
import { createAuditLog } from './audit-log';
import { settleAuction } from './auction-engine';
import type { PendingChangeAction, SessionUser } from './types';

/**
 * Maker–checker workflow.
 *
 * Sensitive operations are recorded as a PendingChange instead of being applied
 * directly. A second admin with `approve` on the module reviews the exact diff
 * and applies it. The maker can never approve their own change.
 */

export interface RequestChangeInput {
  entityType: string;
  entityId?: string;
  action: PendingChangeAction;
  payload: Record<string, unknown>;
  previousData?: Record<string, unknown> | null;
  summary?: string;
  user: SessionUser;
}

/** Field-level diff so reviewers see exactly what changed, not two blobs. */
export function diffFields(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>
): string[] {
  if (!previous) return Object.keys(next);
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const before = previous[key];
    const normalize = (v: unknown) =>
      v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : v;
    if (JSON.stringify(normalize(before)) !== JSON.stringify(normalize(value))) {
      changed.push(key);
    }
  }
  return changed;
}

export async function requiresApproval(kind: 'publish' | 'settings' | 'settlement') {
  const settings = await getSettings();
  if (kind === 'publish') return Boolean(settings['security.requireApprovalForPublish']);
  if (kind === 'settings') return Boolean(settings['security.requireApprovalForSettings']);
  return Boolean(settings['security.requireApprovalForSettlement']);
}

export async function requestChange(input: RequestChangeInput) {
  const changedFields = diffFields(input.previousData, input.payload);

  const change = await prisma.pendingChange.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: JSON.stringify(input.payload),
      previousData: input.previousData ? JSON.stringify(input.previousData) : undefined,
      changedFields: JSON.stringify(changedFields),
      summary: input.summary,
      status: 'PENDING',
      createdById: input.user.id,
    },
  });

  await createAuditLog({
    actorId: input.user.id,
    actorName: input.user.fullName,
    action: 'CHANGE_REQUESTED',
    entity: input.entityType,
    entityId: input.entityId,
    details: { changeId: change.id, action: input.action, changedFields, summary: input.summary },
  });

  return change;
}

export interface DecisionResult {
  ok: boolean;
  message: string;
  applied?: boolean;
}

export async function decideChange(
  changeId: string,
  decision: 'APPROVED' | 'REJECTED',
  user: SessionUser,
  comment?: string
): Promise<DecisionResult> {
  const change = await prisma.pendingChange.findUnique({ where: { id: changeId } });
  if (!change) return { ok: false, message: 'Change request not found.' };
  if (change.status !== 'PENDING') {
    return { ok: false, message: `This request was already ${change.status.toLowerCase()}.` };
  }
  if (change.createdById === user.id) {
    return { ok: false, message: 'You cannot approve a change you requested yourself.' };
  }

  if (decision === 'REJECTED') {
    await prisma.pendingChange.update({
      where: { id: changeId },
      data: { status: 'REJECTED', approvedById: user.id, decidedAt: new Date(), comment },
    });
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'CHANGE_REJECTED',
      entity: change.entityType,
      entityId: change.entityId ?? undefined,
      details: { changeId, comment },
    });
    return { ok: true, message: 'Change request rejected.' };
  }

  let applied = false;
  let applyError: string | null = null;
  try {
    applied = await applyChange(change, user);
  } catch (error: any) {
    applyError = error?.message || 'Failed to apply the change.';
  }

  if (!applied) {
    return { ok: false, message: applyError || 'The change could not be applied.' };
  }

  await prisma.pendingChange.update({
    where: { id: changeId },
    data: { status: 'APPROVED', approvedById: user.id, decidedAt: new Date(), comment },
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'CHANGE_APPROVED',
    entity: change.entityType,
    entityId: change.entityId ?? undefined,
    details: { changeId, action: change.action, comment },
  });

  return { ok: true, message: 'Change approved and applied.', applied: true };
}

/** Applies an approved change. Each entity type states exactly what it accepts. */
async function applyChange(
  change: {
    id: string;
    entityType: string;
    entityId: string | null;
    action: string;
    payload: string;
  },
  user: SessionUser
): Promise<boolean> {
  const payload = JSON.parse(change.payload || '{}');

  switch (change.entityType) {
    case 'Auction': {
      if (!change.entityId) throw new Error('Change is missing its auction reference.');

      if (change.action === 'PUBLISH') {
        const auction = await prisma.auction.findUnique({ where: { id: change.entityId } });
        if (!auction) throw new Error('Auction no longer exists.');
        const status = auction.startAt <= new Date() ? 'LIVE' : 'SCHEDULED';
        await prisma.auction.update({
          where: { id: change.entityId },
          data: { status, publishedAt: new Date() },
        });
        return true;
      }

      if (change.action === 'CANCEL') {
        await prisma.auction.update({
          where: { id: change.entityId },
          data: { status: 'CANCELLED', cancelledReason: payload.reason ?? 'Cancelled by admin' },
        });
        return true;
      }

      if (change.action === 'SETTLE') {
        const result = await settleAuction(
          change.entityId,
          { id: user.id, name: user.fullName },
          { force: Boolean(payload.force) }
        );
        if (!result.settled) throw new Error(result.reason || 'Settlement was not applied.');
        return true;
      }

      if (change.action === 'UPDATE') {
        await prisma.auction.update({ where: { id: change.entityId }, data: payload });
        return true;
      }
      throw new Error(`Unsupported auction change action: ${change.action}`);
    }

    case 'SystemSetting': {
      const entries = Object.entries(payload as Record<string, string | number | boolean>);
      for (const [key, value] of entries) {
        await setSetting(key, value, user.id);
      }
      return true;
    }

    case 'Item': {
      if (change.action === 'CREATE') {
        await prisma.item.create({ data: { ...payload, createdById: user.id } });
        return true;
      }
      if (!change.entityId) throw new Error('Change is missing its item reference.');
      if (change.action === 'DELETE') {
        await prisma.item.update({ where: { id: change.entityId }, data: { status: 'INACTIVE' } });
        return true;
      }
      await prisma.item.update({ where: { id: change.entityId }, data: payload });
      return true;
    }

    case 'Category': {
      if (change.action === 'CREATE') {
        await prisma.category.create({ data: payload });
        return true;
      }
      if (!change.entityId) throw new Error('Change is missing its category reference.');
      await prisma.category.update({ where: { id: change.entityId }, data: payload });
      return true;
    }

    case 'Banner': {
      if (change.action === 'CREATE') {
        await prisma.banner.create({ data: payload });
        return true;
      }
      if (!change.entityId) throw new Error('Change is missing its banner reference.');
      if (change.action === 'DELETE') {
        await prisma.banner.delete({ where: { id: change.entityId } });
        return true;
      }
      await prisma.banner.update({ where: { id: change.entityId }, data: payload });
      return true;
    }

    default:
      throw new Error(`No apply handler is registered for ${change.entityType}.`);
  }
}

export async function pendingCountForUser(user: SessionUser) {
  return prisma.pendingChange.count({
    where: { status: 'PENDING', NOT: { createdById: user.id } },
  });
}
