import { readFile, stat } from 'fs/promises';
import { NextResponse } from 'next/server';
import { resolveUploadPath, uploadContentType } from '@/lib/uploads';

/**
 * Serves uploaded artwork from disk.
 *
 * In production the `public/` folder is indexed once when the server boots, so
 * files written by the upload endpoint afterwards are invisible to it — the
 * cause of images appearing broken on a deployed server while working in dev.
 * Reading per request fixes that without changing any stored URL.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;

  const filePath = resolveUploadPath(filename);
  const contentType = uploadContentType(filename);
  if (!filePath || !contentType) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new NextResponse('Not found', { status: 404 });

    const data = await readFile(filePath);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        // Names are UUIDs, so a stored file never changes underneath a URL.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      console.error('[uploads] read failed', error);
    }
    return new NextResponse('Not found', { status: 404 });
  }
}
