import { NextRequest, NextResponse } from 'next/server';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import {
  cleanDescription,
  cleanName,
  createList,
  importIntoList,
  listSummaries,
  ParticipantListError,
} from '@/lib/participant-lists';
import {
  emptyParseError,
  isUploadFailure,
  readParticipantUpload,
} from '@/lib/participant-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Saved participant lists — the reusable rosters a restricted auction is built
 * from.
 *
 * GET  — every list with its counts
 * POST — create one, optionally importing a file in the same request
 */
export async function GET() {
  const guard = await requirePermission('content.participant-lists', 'read');
  if (isGuardFailure(guard)) return guard.response;

  return NextResponse.json({ lists: await listSummaries() });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('content.participant-lists', 'create');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;
  const actor = { id: user.id, fullName: user.fullName };

  const contentType = req.headers.get('content-type') || '';

  // A list and its numbers in one request — the operator picked a file and
  // typed a name in the same dialog, so splitting it into two calls would only
  // create a window where a half-made list exists.
  if (contentType.includes('multipart/form-data')) {
    const upload = await readParticipantUpload(req);
    if (isUploadFailure(upload)) return jsonError(upload.error, upload.status);

    let name: string;
    try {
      name = cleanName(upload.fields.name);
    } catch (error) {
      return toError(error);
    }

    if (upload.parsed.entries.length === 0) {
      const failure = emptyParseError(upload.parsed);
      return jsonError(failure.error, failure.status, { rejected: failure.rejected });
    }

    try {
      const list = await createList({
        name,
        description: cleanDescription(upload.fields.description),
        actor,
      });
      const summary = await importIntoList({
        listId: list.id,
        entries: upload.parsed.entries,
        mode: 'replace',
        actor,
        parsed: upload.parsed,
      });

      return NextResponse.json({
        ok: true,
        id: list.id,
        ...summary,
        rejected: summary.rejected.slice(0, 20),
        rejectedTotal: summary.rejected.length,
      });
    } catch (error) {
      return toError(error);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const list = await createList({
      name: cleanName(body.name),
      description: cleanDescription(body.description),
      actor,
    });
    return NextResponse.json({ ok: true, id: list.id, total: 0 });
  } catch (error) {
    return toError(error);
  }
}

function toError(error: unknown) {
  if (error instanceof ParticipantListError) return jsonError(error.message, error.status);
  throw error;
}
