import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import { importIntoList, ParticipantListError } from '@/lib/participant-lists';
import { emptyParseError, isUploadFailure, readParticipantUpload } from '@/lib/participant-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The numbers on a saved list.
 *
 * POST   — import a file or pasted text, replacing or appending
 * DELETE — empty the list, keeping the list itself
 *
 * Nothing here touches an auction: rosters already copied from this list stay
 * exactly as they were, and only pick up the change if somebody re-syncs.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const { id } = await params;

  const upload = await readParticipantUpload(req);
  if (isUploadFailure(upload)) return jsonError(upload.error, upload.status);

  if (upload.parsed.entries.length === 0) {
    const failure = emptyParseError(upload.parsed);
    return jsonError(failure.error, failure.status, { rejected: failure.rejected });
  }

  try {
    const summary = await importIntoList({
      listId: id,
      entries: upload.parsed.entries,
      mode: upload.mode,
      actor: { id: user.id, fullName: user.fullName },
      parsed: upload.parsed,
    });

    return NextResponse.json({
      ok: true,
      ...summary,
      // Only the first few are worth showing; the rest would fill the screen.
      rejected: summary.rejected.slice(0, 20),
      rejectedTotal: summary.rejected.length,
    });
  } catch (error) {
    if (error instanceof ParticipantListError) return jsonError(error.message, error.status);
    throw error;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('content', 'update');
  if (isGuardFailure(guard)) return guard.response;

  const { id } = await params;
  const list = await prisma.participantList.findUnique({ where: { id }, select: { id: true } });
  if (!list) return jsonError('List not found', 404);

  const { count } = await prisma.participantListEntry.deleteMany({ where: { listId: id } });
  await prisma.participantList.update({ where: { id }, data: { updatedAt: new Date() } });

  return NextResponse.json({ ok: true, removed: count });
}
