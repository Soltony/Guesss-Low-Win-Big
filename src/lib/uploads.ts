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
