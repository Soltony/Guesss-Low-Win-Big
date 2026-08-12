import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function GET() {
  const guard = await requirePermission('categories', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const categories = await prisma.category.findMany({
    orderBy: { displayOrder: 'asc' },
    include: { _count: { select: { items: true, auctions: true } } },
  });

  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('categories', 'create');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jsonError('Category name is required.', 400);

  const baseSlug = slugify(String(body.slug || name)) || `category-${Date.now()}`;

  // Slugs are unique and used in mini-app links, so resolve collisions here
  // rather than surfacing a database error to the operator.
  let slug = baseSlug;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const clash = await prisma.category.findUnique({ where: { slug } });
    if (!clash) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const category = await prisma.category.create({
    data: {
      name,
      nameAm: body.nameAm ? String(body.nameAm) : undefined,
      slug,
      imageUrl: body.imageUrl ? String(body.imageUrl) : undefined,
      icon: body.icon ? String(body.icon) : undefined,
      displayOrder: Math.trunc(Number(body.displayOrder) || 0),
      status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    },
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'CATEGORY_CREATED',
    entity: 'Category',
    entityId: category.id,
    details: { name, slug },
  });

  return NextResponse.json({ id: category.id, slug }, { status: 201 });
}
