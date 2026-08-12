import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || '');

  if (kind === 'banner') {
    const banner = await prisma.banner.findUnique({ where: { id } });
    if (!banner) return jsonError('Banner not found', 404);

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return jsonError('Banner title cannot be empty.', 400);
      data.title = title;
    }
    if (body.titleAm !== undefined) data.titleAm = String(body.titleAm) || null;
    if (body.subtitle !== undefined) data.subtitle = String(body.subtitle) || null;
    if (body.imageUrl !== undefined) {
      const imageUrl = String(body.imageUrl).trim();
      if (!imageUrl) return jsonError('Banner image URL cannot be empty.', 400);
      data.imageUrl = imageUrl;
    }
    if (body.linkUrl !== undefined) data.linkUrl = String(body.linkUrl) || null;
    if (body.displayOrder !== undefined) {
      data.displayOrder = Math.trunc(Number(body.displayOrder) || 0);
    }
    if (body.status !== undefined) {
      data.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    }
    if (body.startAt !== undefined) data.startAt = body.startAt ? new Date(body.startAt) : null;
    if (body.endAt !== undefined) data.endAt = body.endAt ? new Date(body.endAt) : null;

    if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

    await prisma.banner.update({ where: { id }, data });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'BANNER_UPDATED',
      entity: 'Banner',
      entityId: id,
      details: { changed: Object.keys(data) },
    });

    return NextResponse.json({ ok: true });
  }

  if (kind === 'terms') {
    const terms = await prisma.termsAndConditions.findUnique({ where: { id } });
    if (!terms) return jsonError('Terms version not found', 404);

    if (body.activate) {
      await prisma.$transaction(async (tx) => {
        await tx.termsAndConditions.updateMany({
          where: { active: true },
          data: { active: false },
        });
        await tx.termsAndConditions.update({ where: { id }, data: { active: true } });
      });

      await createAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'TERMS_ACTIVATED',
        entity: 'TermsAndConditions',
        entityId: id,
        details: { version: terms.version },
      });

      return NextResponse.json({ ok: true });
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = String(body.title).trim();
    if (body.contentEn !== undefined) data.contentEn = String(body.contentEn);
    if (body.contentAm !== undefined) data.contentAm = String(body.contentAm) || null;
    if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

    await prisma.termsAndConditions.update({ where: { id }, data });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'TERMS_UPDATED',
      entity: 'TermsAndConditions',
      entityId: id,
      details: { version: terms.version, changed: Object.keys(data) },
    });

    return NextResponse.json({ ok: true });
  }

  return jsonError('Unsupported content kind.', 400);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('content', 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  const kind = new URL(req.url).searchParams.get('kind');

  if (kind === 'banner') {
    const banner = await prisma.banner.findUnique({ where: { id } });
    if (!banner) return jsonError('Banner not found', 404);

    await prisma.banner.delete({ where: { id } });
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'BANNER_DELETED',
      entity: 'Banner',
      entityId: id,
      details: { title: banner.title },
    });
    return NextResponse.json({ ok: true });
  }

  if (kind === 'terms') {
    const terms = await prisma.termsAndConditions.findUnique({
      where: { id },
      include: { _count: { select: { auctions: true } } },
    });
    if (!terms) return jsonError('Terms version not found', 404);
    if (terms.active) return jsonError('The active terms version cannot be deleted.', 409);
    if (terms._count.auctions > 0) {
      return jsonError(
        `This version is attached to ${terms._count.auctions} auction(s) and must be kept for the record.`,
        409
      );
    }

    await prisma.termsAndConditions.delete({ where: { id } });
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'TERMS_DELETED',
      entity: 'TermsAndConditions',
      entityId: id,
      details: { version: terms.version },
    });
    return NextResponse.json({ ok: true });
  }

  return jsonError('Unsupported content kind.', 400);
}
