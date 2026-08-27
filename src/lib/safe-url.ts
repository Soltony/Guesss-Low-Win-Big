/**
 * URL schemes an operator is allowed to point a bidder at.
 *
 * Banner and advertisement links are typed into the admin console and rendered
 * straight into the mini-app — into an `href`, or handed to `window.open()`.
 * A scheme is not decoration there: `javascript:` in an `href` runs as script
 * in our own origin the moment a bidder taps the card, which turns "an operator
 * saved a banner" into stored XSS against every bidder who sees it.
 *
 * So the scheme is decided here, once, and both ends use it: the API refuses to
 * store anything else, and the components refuse to render anything else. The
 * second check is not redundant — rows written before this existed are still in
 * the database, and validation on write can never reach them.
 *
 * Kept free of Node and Next imports so the same function runs in a route
 * handler, in a client component and in a unit test.
 */

/**
 * Characters a browser strips out of a URL before resolving it.
 *
 * `java\tscript:` and `java\nscript:` navigate exactly like `javascript:`,
 * which is why the string has to be cleaned the same way *before* the scheme is
 * read, rather than after. Anything at or below U+0020, plus DEL, goes.
 */
function stripIgnored(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0020\u007f]/g, '');
}

/**
 * A root-relative path that stays on this origin.
 *
 * `//evil.example` also begins with a slash and is a protocol-relative URL —
 * an absolute jump to another host. So is `/\evil.example`, which browsers
 * normalise backslashes into. Both are refused; a real in-app link never has a
 * separator in second position.
 */
function isSameOriginPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  const second = value[1];
  return second !== '/' && second !== '\\';
}

/**
 * A link an operator may attach to a banner or an ad, or `null`.
 *
 * `https:` absolute URLs and root-relative in-app paths are the whole list.
 * Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, a
 * bare `http:` that would downgrade the connection — comes back `null`, and
 * the caller decides whether that is a 400 or simply a card with no link.
 */
export function safeLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripIgnored(value).trim();
  if (!cleaned) return null;

  if (isSameOriginPath(cleaned)) return cleaned;

  let parsed: URL;
  try {
    // No base is supplied on purpose: a relative string must fail here rather
    // than be resolved against some origin and quietly accepted.
    parsed = new URL(cleaned);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  // A URL with no host — `https:///foo` — resolves against whatever the browser
  // decides, so it is not a destination we can vouch for.
  if (!parsed.hostname) return null;

  return parsed.toString();
}

/**
 * An image source an operator may attach to content, or `null`.
 *
 * Looser than a link because an artwork URL is not a navigation: `http:` is
 * allowed so a staging deployment behind plain HTTP still shows its uploads,
 * and `/uploads/...` is the normal case. The dangerous schemes are refused for
 * the same reason as above — a stored `javascript:` costs nothing to reject and
 * an `<img>` is one attribute rename away from an `<a>`.
 */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripIgnored(value).trim();
  if (!cleaned) return null;

  if (isSameOriginPath(cleaned)) return cleaned;

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.hostname) return null;

  return parsed.toString();
}

/** The message both content routes return for a link they will not store. */
export const UNSAFE_LINK_MESSAGE =
  'Links must be an https:// address or an in-app path beginning with /.';

/** The message both content routes return for an image they will not store. */
export const UNSAFE_IMAGE_MESSAGE =
  'Image URLs must be an http(s):// address or a path beginning with /.';
