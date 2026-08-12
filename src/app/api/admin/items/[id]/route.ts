import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { round2 } from '@/lib/format';

export const dynamic = 'force-dynamic';

function parseImageList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/[\n,]/)
        .map((s) => s.trim());
  return raw
    .map((v) => String(v).trim())
    .filter(Boolean)
    .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('data:image/'))
    .slice(0, 10);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('items', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return jsonError('Item not found', 404);

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError('Item name cannot be empty.', 400);
    data.name = name;
  }
  if (body.nameAm !== undefined) data.nameAm = String(body.nameAm) || null;
  if (body.description !== undefined) {
    const description = String(body.description).trim();
    if (!description) return jsonError('Description cannot be empty.', 400);
    data.description = description;
  }
  if (body.descriptionAm !== undefined) data.descriptionAm = String(body.descriptionAm) || null;
  if (body.brand !== undefined) data.brand = String(body.brand) || null;
  if (body.model !== undefined) data.model = String(body.model) || null;
  if (body.sku !== undefined) data.sku = String(body.sku) || null;
  if (body.retailPrice !== undefined) {
    const price = round2(Number(body.retailPrice));
    if (!(price >= 0)) return jsonError('Retail price must be zero or more.', 400);
    data.retailPrice = price;
  }
  if (body.images !== undefined) data.images = JSON.stringify(parseImageList(body.images));
  if (body.stockQty !== undefined) {
    data.stockQty = Math.max(0, Math.trunc(Number(body.stockQty) || 0));
  }
  if (body.status !== undefined) {
    data.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }
  if (body.categoryId !== undefined) {
    const category = await prisma.category.findUnique({ where: { id: String(body.categoryId) } });
    if (!category) return jsonError('The selected category does not exist.', 404);
    data.categoryId = category.id;
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

  await prisma.item.update({ where: { id }, data });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'ITEM_UPDATED',
    entity: 'Item',
    entityId: id,
    details: { changed: Object.keys(data) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('items', 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const item = await prisma.item.findUnique({
    where: { id },
    include: { _count: { select: { auctions: true } } },
  });
  if (!item) return jsonError('Item not found', 404);

  // Items referenced by an auction are retired rather than deleted so the
  // auction history keeps rendering.
  if (item._count.auctions > 0) {
    await prisma.item.update({ where: { id }, data: { status: 'INACTIVE' } });
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'ITEM_DEACTIVATED',
      entity: 'Item',
      entityId: id,
      details: { reason: 'Item is used by existing auctions', auctions: item._count.auctions },
    });
    return NextResponse.json({
      ok: true,
      deactivated: true,
      message: 'This item is used by existing auctions, so it was deactivated instead of deleted.',
    });
  }

  await prisma.item.delete({ where: { id } });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'ITEM_DELETED',
    entity: 'Item',
    entityId: id,
    details: { name: item.name },
  });

  return NextResponse.json({ ok: true });
}
