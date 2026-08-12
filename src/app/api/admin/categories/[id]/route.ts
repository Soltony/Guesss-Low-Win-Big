import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('categories', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) return jsonError('Category not found', 404);

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError('Category name cannot be empty.', 400);
    data.name = name;
  }
  if (body.nameAm !== undefined) data.nameAm = String(body.nameAm) || null;
  if (body.imageUrl !== undefined) data.imageUrl = String(body.imageUrl) || null;
  if (body.icon !== undefined) data.icon = String(body.icon) || null;
  if (body.displayOrder !== undefined) {
    data.displayOrder = Math.trunc(Number(body.displayOrder) || 0);
  }
  if (body.status !== undefined) {
    data.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  await prisma.category.update({ where: { id }, data });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'CATEGORY_UPDATED',
    entity: 'Category',
    entityId: id,
    details: { changed: Object.keys(data) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('categories', 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { items: true, auctions: true } } },
  });
  if (!category) return jsonError('Category not found', 404);

  if (category._count.items > 0 || category._count.auctions > 0) {
    return jsonError(
      `This category still holds ${category._count.items} item(s) and ${category._count.auctions} auction(s). Move them first, or set the category to inactive.`,
      409
    );
  }

  await prisma.category.delete({ where: { id } });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'CATEGORY_DELETED',
    entity: 'Category',
    entityId: id,
    details: { name: category.name },
  });

  return NextResponse.json({ ok: true });
}
