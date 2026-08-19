import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { isAdFrequency, parseAdSchedule, parseAdTimings } from '@/lib/ads';
import { CONTENT_KIND_MODULES } from '@/lib/route-permissions';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonBody(req);
  if (body === null) return jsonError('Request body is too large.', 413);
  const kind = String(body?.kind || '');

  // Which Content tab this edit belongs to, and therefore which permission it
  // needs, is only knowable once the payload is parsed.
  const moduleKey = CONTENT_KIND_MODULES[kind];
  if (!moduleKey) return jsonError('Unsupported content kind.', 400);

  const guard = await requirePermission(moduleKey, 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

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

  if (kind === 'ad') {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) return jsonError('Ad not found', 404);

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return jsonError('Ad title cannot be empty.', 400);
      data.title = title;
    }
    if (body.titleAm !== undefined) data.titleAm = String(body.titleAm) || null;
    if (body.body !== undefined) data.body = String(body.body).trim() || null;
    if (body.bodyAm !== undefined) data.bodyAm = String(body.bodyAm) || null;
    if (body.imageUrl !== undefined) data.imageUrl = String(body.imageUrl).trim() || null;
    if (body.ctaLabel !== undefined) data.ctaLabel = String(body.ctaLabel) || null;
    if (body.ctaLabelAm !== undefined) data.ctaLabelAm = String(body.ctaLabelAm) || null;
    if (body.linkUrl !== undefined) data.linkUrl = String(body.linkUrl).trim() || null;
    if (body.frequency !== undefined) {
      if (!isAdFrequency(body.frequency)) return jsonError('Unsupported ad frequency.', 400);
      data.frequency = body.frequency;
    }
    if (body.status !== undefined) {
      data.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    }
    if (body.displayOrder !== undefined) {
      data.displayOrder = Math.trunc(Number(body.displayOrder) || 0);
    }
    // The two countdowns are validated against each other, so an edit that
    // touches either one is checked against the stored value of the other.
    if (body.autoCloseSeconds !== undefined || body.minViewSeconds !== undefined) {
      const timings = parseAdTimings(
        body.minViewSeconds !== undefined ? body.minViewSeconds : ad.minViewSeconds,
        body.autoCloseSeconds !== undefined ? body.autoCloseSeconds : ad.autoCloseSeconds
      );
      if ('error' in timings) return jsonError(timings.error, 400);
      if (body.autoCloseSeconds !== undefined) data.autoCloseSeconds = timings.autoCloseSeconds;
      if (body.minViewSeconds !== undefined) data.minViewSeconds = timings.minViewSeconds;
    }
    if (body.startAt !== undefined || body.endAt !== undefined) {
      const schedule = parseAdSchedule({
        startAt: body.startAt !== undefined ? body.startAt : ad.startAt,
        endAt: body.endAt !== undefined ? body.endAt : ad.endAt,
      });
      if ('error' in schedule) return jsonError(schedule.error, 400);
      if (body.startAt !== undefined) data.startAt = schedule.startAt;
      if (body.endAt !== undefined) data.endAt = schedule.endAt;
    }

    // The ad still has to carry something a bidder can see once the edit lands.
    const nextImage = data.imageUrl !== undefined ? data.imageUrl : ad.imageUrl;
    const nextBody = data.body !== undefined ? data.body : ad.body;
    if (!nextImage && !nextBody) {
      return jsonError('An ad needs an image, a message, or both.', 400);
    }

    if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400);

    await prisma.advertisement.update({ where: { id }, data });

    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AD_UPDATED',
      entity: 'Advertisement',
      entityId: id,
      details: { title: ad.title, changed: Object.keys(data) },
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
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get('kind') ?? '';

  const moduleKey = CONTENT_KIND_MODULES[kind];
  if (!moduleKey) return jsonError('Unsupported content kind.', 400);

  const guard = await requirePermission(moduleKey, 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

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

  if (kind === 'ad') {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) return jsonError('Ad not found', 404);

    // Impressions cascade with the ad — they are per-bidder frequency state,
    // not a record anyone reports on once the ad is gone.
    await prisma.advertisement.delete({ where: { id } });
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AD_DELETED',
      entity: 'Advertisement',
      entityId: id,
      details: { title: ad.title, impressions: ad.impressions, clicks: ad.clicks },
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
