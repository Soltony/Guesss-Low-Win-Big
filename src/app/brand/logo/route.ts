import { readFile, stat } from 'fs/promises';
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settings';
import { resolveUploadPath, uploadContentType } from '@/lib/uploads';

/**
 * The app icon, at a URL that never changes.
 *
 * `metadata.icons` in the root layout is static, so it cannot point straight at
 * the uploaded file — the stored URL changes every time a new icon is saved.
 * Pointing the browser here instead keeps the tag fixed and resolves the
 * current icon per request, falling back to the built-in mark when none is set.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The inline mark from `components/icons.tsx`, with the theme colours baked in
 * — a favicon is served standalone, so it cannot inherit them. */
const DEFAULT_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
<rect width="32" height="32" rx="8" fill="hsl(45,93%,47%)"/>
<rect x="7" y="9" width="4" height="14" rx="1.5" fill="#0b0f19" opacity="0.35"/>
<rect x="14" y="13" width="4" height="10" rx="1.5" fill="#0b0f19" opacity="0.55"/>
<rect x="21" y="17" width="4" height="6" rx="1.5" fill="#0b0f19"/>
<circle cx="23" cy="12" r="2" fill="#0b0f19"/>
</svg>`;

// Browsers hold on to favicons hard. Revalidating on every use is the only way
// a re-uploaded icon shows up without the operator clearing their cache.
const CACHE_CONTROL = 'public, max-age=0, must-revalidate';

function defaultMark() {
  return new NextResponse(DEFAULT_MARK, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': CACHE_CONTROL },
  });
}

export async function GET() {
  let logoUrl = '';
  try {
    const settings = await getSettings();
    logoUrl = String(settings['platform.logoUrl'] ?? '').trim();
  } catch (error) {
    console.error('[brand] could not read the icon setting', error);
  }

  if (!logoUrl) return defaultMark();

  // An icon hosted elsewhere: hand the browser the real URL.
  if (/^https?:\/\//i.test(logoUrl)) return NextResponse.redirect(logoUrl, 307);

  // Anything else is one of our own uploads, served from disk the same way
  // `/uploads/[filename]` does — `public/` cannot serve files written at runtime.
  const filename = logoUrl.startsWith('/uploads/') ? logoUrl.slice('/uploads/'.length) : '';
  const filePath = filename ? resolveUploadPath(filename) : null;
  const contentType = filename ? uploadContentType(filename) : null;
  if (!filePath || !contentType) return defaultMark();

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return defaultMark();

    const data = await readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        'Cache-Control': CACHE_CONTROL,
      },
    });
  } catch (error: any) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      console.error('[brand] icon read failed', error);
    }
    return defaultMark();
  }
}
