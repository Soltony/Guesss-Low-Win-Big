import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { isAdFrequency, parseAdSchedule, parseAdTimings } from '@/lib/ads';
import { CONTENT_KIND_MODULES } from '@/lib/route-permissions';

export const dynamic = 'force-dynamic';

/**
 * Home-page banners, ad popups and the terms &amp; conditions library live under
 * Content, each on its own tab with its own permission. The tab is decided by
 * `kind` in the payload, which the proxy cannot see, so the check happens here.
 */
export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const kind = String(body?.kind || '');

  const moduleKey = CONTENT_KIND_MODULES[kind];
  if (!moduleKey) return jsonError('Unsupported content kind.', 400);

  const guard = await requirePermission(moduleKey, 'create');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  if (kind === 'banner') {
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
        imageAlt: body.imageAlt ? String(body.imageAlt).trim() : undefined,
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

  if (kind === 'ad') {
    const title = String(body.title || '').trim();
    if (!title) return jsonError('Ad title is required.', 400);

    const imageUrl = String(body.imageUrl || '').trim();
    const bodyText = String(body.body || '').trim();
    if (!imageUrl && !bodyText) {
      return jsonError('An ad needs an image, a message, or both.', 400);
    }

    const schedule = parseAdSchedule(body);
    if ('error' in schedule) return jsonError(schedule.error, 400);

    const timings = parseAdTimings(body.minViewSeconds, body.autoCloseSeconds);
    if ('error' in timings) return jsonError(timings.error, 400);

    const frequency = isAdFrequency(body.frequency) ? body.frequency : 'ONCE_PER_DAY';

    const ad = await prisma.advertisement.create({
      data: {
        title,
        titleAm: body.titleAm ? String(body.titleAm) : undefined,
        body: bodyText || undefined,
        bodyAm: body.bodyAm ? String(body.bodyAm) : undefined,
        imageUrl: imageUrl || undefined,
        imageAlt: body.imageAlt ? String(body.imageAlt).trim() : undefined,
        ctaLabel: body.ctaLabel ? String(body.ctaLabel) : undefined,
        ctaLabelAm: body.ctaLabelAm ? String(body.ctaLabelAm) : undefined,
        linkUrl: body.linkUrl ? String(body.linkUrl).trim() : undefined,
        placement: 'POST_LOGIN',
        frequency,
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        displayOrder: Math.trunc(Number(body.displayOrder) || 0),
        autoCloseSeconds: timings.autoCloseSeconds,
        minViewSeconds: timings.minViewSeconds,
        startAt: schedule.startAt ?? undefined,
        endAt: schedule.endAt ?? undefined,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AD_CREATED',
      entity: 'Advertisement',
      entityId: ad.id,
      details: { title, frequency, status: ad.status },
    });

    return NextResponse.json({ id: ad.id }, { status: 201 });
  }

  if (kind === 'terms') {
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
