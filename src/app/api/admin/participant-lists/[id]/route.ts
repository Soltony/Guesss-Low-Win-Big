import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, parsePaging, readJsonBody, requirePermission } from '@/lib/api';
import {
  cleanDescription,
  cleanName,
  deleteList,
  ParticipantListError,
  updateList,
} from '@/lib/participant-lists';
import { toParticipantCsv } from '@/lib/participant-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One saved participant list.
 *
 * GET    — page through its numbers, or export them with `?format=csv`
 * PATCH  — rename, re-describe, archive or restore
 * DELETE — remove it, leaving every auction built from it untouched
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content.participant-lists', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const { id } = await params;
  const list = await prisma.participantList.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, active: true, updatedAt: true },
  });
  if (!list) return jsonError('List not found', 404);

  const url = new URL(req.url);

  if (url.searchParams.get('format') === 'csv') {
    const all = await prisma.participantListEntry.findMany({
      where: { listId: id },
      orderBy: { createdAt: 'asc' },
      select: { phoneNumber: true, fullName: true, note: true },
    });

    // A list named "Head office staff" becomes head-office-staff.csv.
    const slug = list.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

    return new NextResponse(toParticipantCsv(all), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.csv"`,
      },
    });
  }

  const search = url.searchParams.get('q')?.trim() || '';
  const where = {
    listId: id,
    ...(search
      ? {
          OR: [
            { phoneNumber: { contains: search.replace(/\D/g, '') || search } },
            { fullName: { contains: search } },
          ],
        }
      : {}),
  };

  const { skip, take, page, pageSize } = parsePaging(req, 50);

  const [rows, total, listTotal] = await Promise.all([
    prisma.participantListEntry.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    }),
    prisma.participantListEntry.count({ where }),
    prisma.participantListEntry.count({ where: { listId: id } }),
  ]);

  // Whether each number belongs to somebody who has actually opened the
  // mini-app, resolved by phone — a saved list is usually uploaded long before
  // most of these people have a bidder profile at all.
  const bidders = await prisma.bidder.findMany({
    where: { phoneNumber: { in: rows.map((row) => row.phoneNumber) } },
    select: { phoneNumber: true, fullName: true, status: true },
  });
  const byPhone = new Map(bidders.map((bidder) => [bidder.phoneNumber, bidder]));

  return NextResponse.json({
    page,
    pageSize,
    total,
    listTotal,
    list: {
      id: list.id,
      name: list.name,
      description: list.description ?? '',
      active: list.active,
      updatedAt: list.updatedAt.toISOString(),
    },
    entries: rows.map((row) => {
      const bidder = byPhone.get(row.phoneNumber);
      return {
        id: row.id,
        phoneNumber: row.phoneNumber,
        fullName: row.fullName,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        registered: Boolean(bidder),
        bidderName: bidder?.fullName ?? null,
        bidderStatus: bidder?.status ?? null,
      };
    }),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content.participant-lists', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;
  // Not cast straight to a record: the cast would swallow the refusal and
  // treat it as an empty body.
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed as Record<string, unknown>;

  try {
    await updateList({
      id,
      ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
      ...(body.description !== undefined
        ? { description: cleanDescription(body.description) }
        : {}),
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      actor: { id: user.id, fullName: user.fullName },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ParticipantListError) return jsonError(error.message, error.status);
    throw error;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content.participant-lists', 'delete');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;

  try {
    await deleteList(id, { id: user.id, fullName: user.fullName });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ParticipantListError) return jsonError(error.message, error.status);
    throw error;
  }
}
