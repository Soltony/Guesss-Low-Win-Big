import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { jsonError } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import { ALLOWED_IMAGE_TYPES, uploadsDir } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

// SVG is deliberately excluded: it can carry script and would execute when
// served from our own origin.
const ALLOWED = ALLOWED_IMAGE_TYPES;

/** Modules whose editors are allowed to upload artwork. */
const UPLOAD_MODULES = ['items', 'categories', 'content'] as const;

/** Magic-number check, so a renamed file cannot slip past the declared type. */
function sniff(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // AVIF/HEIF: 'ftyp' box at offset 4.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'image/avif';
  }
  return null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser({ allowRefresh: false });
  if (!user) return jsonError('Not authenticated', 401);

  const allowed = UPLOAD_MODULES.some(
    (module) => hasPermission(user, module, 'create') || hasPermission(user, module, 'update')
  );
  if (!allowed) return jsonError('You do not have permission to upload images.', 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('Expected a multipart form upload.', 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return jsonError('No file was supplied.', 400);

  if (file.size === 0) return jsonError('The selected file is empty.', 400);
  if (file.size > MAX_BYTES) {
    return jsonError(
      `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`,
      413
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = sniff(bytes);

  if (!detected || !ALLOWED[detected]) {
    return jsonError('Only PNG, JPEG, WebP, GIF and AVIF images are accepted.', 415);
  }

  // The filename is generated, never taken from the upload, so path traversal
  // and overwrites are impossible by construction.
  const filename = `${randomUUID()}.${ALLOWED[detected]}`;
  const directory = uploadsDir();

  try {
    await mkdir(directory, { recursive: true });
    // The directory is chosen at runtime (`UPLOAD_DIR`), so Turbopack cannot
    // statically scope this join and would trace the whole project — including
    // `public/` — into the server output. Nothing here is bundled: the path is
    // only ever written to at request time.
    await writeFile(path.join(/*turbopackIgnore: true*/ directory, filename), bytes);
  } catch (error) {
    console.error('[uploads] write failed', error);
    return jsonError('Could not save the image on the server.', 500);
  }

  const url = `/uploads/${filename}`;

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'IMAGE_UPLOADED',
    entity: 'Upload',
    entityId: filename,
    details: {
      url,
      bytes: file.size,
      type: detected,
      originalName: 'name' in file ? String(file.name).slice(0, 200) : undefined,
    },
  });

  return NextResponse.json({ url, filename, size: file.size, type: detected }, { status: 201 });
}
