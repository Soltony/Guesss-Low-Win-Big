import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/** Home-page banners and the terms &amp; conditions library live under Content. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || '');

  if (kind === 'banner') {
    const guard = await requirePermission('content', 'create');
    if (isGuardFailure(guard)) return guard.response;
    const { user } = guard;

    const title = String(body.title || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    if (!title) return jsonError('Banner title is required.', 400);
    if (!imageUrl) return jsonError('Banner image URL is required.', 400);

    const banner = await prisma.banner.create({
      data: {
        title,
        titleAm: body.titleAm ? String(body.titleAm) : undefined,
        subtitle: body.subtitle ? String(body.subtitle) : undefined,
        imageUrl,
        linkUrl: body.linkUrl ? String(body.linkUrl) : undefined,
        displayOrder: Math.trunc(Number(body.displayOrder) || 0),
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'BANNER_CREATED',
      entity: 'Banner',
      entityId: banner.id,
      details: { title },
    });

    return NextResponse.json({ id: banner.id }, { status: 201 });
  }

  if (kind === 'terms') {
    const guard = await requirePermission('content', 'create');
    if (isGuardFailure(guard)) return guard.response;
    const { user } = guard;

    const version = String(body.version || '').trim();
    const title = String(body.title || '').trim();
    const contentEn = String(body.contentEn || '').trim();
    if (!version) return jsonError('Version is required.', 400);
    if (!title) return jsonError('Title is required.', 400);
    if (!contentEn) return jsonError('English content is required.', 400);

    const makeActive = Boolean(body.active);

    const terms = await prisma.$transaction(async (tx) => {
      // Exactly one active version at a time — the mini-app shows "the" terms.
      if (makeActive) {
        await tx.termsAndConditions.updateMany({
          where: { active: true },
          data: { active: false },
        });
      }
      return tx.termsAndConditions.create({
        data: {
          version,
          title,
          contentEn,
          contentAm: body.contentAm ? String(body.contentAm) : undefined,
          active: makeActive,
        },
      });
    });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'TERMS_CREATED',
      entity: 'TermsAndConditions',
      entityId: terms.id,
      details: { version, active: makeActive },
    });

    return NextResponse.json({ id: terms.id }, { status: 201 });
  }

  return jsonError('Unsupported content kind.', 400);
}
