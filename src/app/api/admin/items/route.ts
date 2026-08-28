import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, parsePaging, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { round2, toNum } from '@/lib/format';

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
    // Absolute remote URLs, or a path served from our own /uploads folder.
    .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('/uploads/'))
    .slice(0, 10);
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('items', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const url = new URL(req.url);
  const search = url.searchParams.get('q') || undefined;
  const categoryId = url.searchParams.get('categoryId') || undefined;
  const { skip, take, page, pageSize } = parsePaging(req);

  const where: any = {
    ...(categoryId ? { categoryId } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { brand: { contains: search } }] }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { category: { select: { name: true } }, _count: { select: { auctions: true } } },
    }),
    prisma.item.count({ where }),
  ]);

  return NextResponse.json({
    page,
    pageSize,
    total,
    items: rows.map((item) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      status: item.status,
      category: item.category.name,
      retailPrice: toNum(item.retailPrice),
      auctionCount: item._count.auctions,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('items', 'create');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const body = await readJsonBody(req);
  if (body instanceof NextResponse) return body;
  const name = String(body.name || '').trim();
  const categoryId = String(body.categoryId || '');
  const description = String(body.description || '').trim();
  const retailPrice = round2(Number(body.retailPrice));

  if (!name) return jsonError('Item name is required.', 400);
  if (!categoryId) return jsonError('Category is required.', 400);
  if (!description) return jsonError('Description is required.', 400);
  if (!(retailPrice >= 0)) return jsonError('Retail price must be zero or more.', 400);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return jsonError('The selected category does not exist.', 404);

  const item = await prisma.item.create({
    data: {
      name,
      nameAm: body.nameAm ? String(body.nameAm) : undefined,
      description,
      descriptionAm: body.descriptionAm ? String(body.descriptionAm) : undefined,
      brand: body.brand ? String(body.brand) : undefined,
      model: body.model ? String(body.model) : undefined,
      sku: body.sku ? String(body.sku) : undefined,
      retailPrice,
      images: JSON.stringify(parseImageList(body.images)),
      categoryId,
      stockQty: Math.max(0, Math.trunc(Number(body.stockQty) || 1)),
      status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      createdById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'ITEM_CREATED',
    entity: 'Item',
    entityId: item.id,
    details: { name, categoryId, retailPrice },
  });

  return NextResponse.json({ id: item.id }, { status: 201 });
}
