import path from 'path';

/**
 * Shared upload storage rules.
 *
 * Uploaded artwork is written at runtime, so it can never be served by the
 * `public/` folder in production: `next start` snapshots that directory once at
 * boot and matches later requests against the in-memory list, which means a file
 * saved after boot 404s until the server restarts. Everything under `/uploads/`
 * is therefore served by a route handler that reads from disk per request — see
 * `src/app/uploads/[filename]/route.ts`.
 */

/** Accepted upload types, mapped to the extension we store them under. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Extension -> Content-Type, for serving. `nosniff` is set globally, so this
 * has to be right or the browser refuses to render the image. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/**
 * Where uploads live. Defaults to `public/uploads` so existing files and the
 * URLs already stored against items keep resolving. Point `UPLOAD_DIR` at a
 * persistent volume in deployments where the app directory is replaced on
 * release, otherwise artwork disappears on the next deploy.
 */
export function uploadsDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), 'public', 'uploads');
}

/**
 * Resolves a stored filename to an absolute path, or null when it is not a name
 * we generated. Filenames are UUID-based, so anything containing a separator or
 * a traversal segment is rejected before it reaches the filesystem.
 */
export function resolveUploadPath(filename: string): string | null {
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) return null;

  const directory = uploadsDir();
  const resolved = path.resolve(directory, filename);

  // Defence in depth: the regex already excludes separators. `uploadsDir()`
  // always returns an absolute, normalised path, so it is compared as-is —
  // re-resolving it makes Turbopack trace the whole project into the output.
  if (path.dirname(resolved) !== directory) return null;

  return resolved;
}

/** Content-Type for a stored filename, or null when the extension is unknown. */
export function uploadContentType(filename: string): string | null {
  const extension = path.extname(filename).slice(1).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? null;
}

/** Four bytes of the buffer as ASCII, for the tags inside an ISO-BMFF header. */
function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * The brands an `ftyp` box may declare for us to call the file an AVIF.
 *
 * `avif` and `avis` are the image and image-sequence brands. `mif1`/`msf1` are
 * the generic HEIF containers an encoder may put in the major slot while naming
 * `avif` among the compatible brands, so those are accepted only on that
 * evidence — never on their own, since the same container holds HEIC.
 */
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_CONTAINER_BRANDS = new Set(['mif1', 'msf1', 'miaf']);

/**
 * Whether an ISO-BMFF header describes an AVIF image.
 *
 * Testing for `ftyp` alone — as this did — accepts any file in the family, and
 * the family is large: MP4 video, QuickTime, HEIC. Worse, `ftyp` at offset 4 is
 * four bytes an attacker writes for free, so a file of any content at all could
 * be stored under an `.avif` name and served back with an image Content-Type.
 * The brand is what actually names the format, so the brand is what is read.
 */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || tag(bytes, 4) !== 'ftyp') return false;

  if (AVIF_BRANDS.has(tag(bytes, 8))) return true;
  if (!HEIF_CONTAINER_BRANDS.has(tag(bytes, 8))) return false;

  // Compatible brands run from offset 16 to the end of the box, four bytes each.
  const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  const end = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.has(tag(bytes, offset))) return true;
  }
  return false;
}

/**
 * Magic-number check, so a renamed file cannot slip past the declared type.
 *
 * The signature decides the stored extension and therefore the Content-Type the
 * file is later served with, so a loose match here is what turns an upload
 * endpoint into a way to host arbitrary content on our own origin.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  // GIF87a and GIF89a; the trailing 'a' rules out a bare "GIF8" prefix.
  if (startsWith(0x47, 0x49, 0x46, 0x38) && bytes[5] === 0x61) return 'image/gif';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    tag(bytes, 8) === 'WEBP' &&
    // A RIFF container is only a WebP if the chunk that follows is one.
    tag(bytes, 12).startsWith('VP8')
  ) {
    return 'image/webp';
  }
  if (isAvif(bytes)) return 'image/avif';
  return null;
}
