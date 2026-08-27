import { SignJWT, decodeJwt, jwtVerify } from 'jose';
import { requireSecret } from './secrets';
import { secureUuid } from './random';

// Kept free of `next/headers` and Prisma imports so token work stays usable
// from any runtime without dragging Node-only code along.

export const ACCESS_TOKEN_EXP = '15m';
export const ACCESS_TOKEN_MINUTES = 15;
export const REFRESH_TOKEN_DAYS = 7;

/**
 * The signing key, resolved at first use and never defaulted.
 *
 * Falling back to an empty string here would sign every admin and bidder token
 * with an empty HMAC key — a key anybody can guess, because it is the absence
 * of one. The application would look perfectly healthy while any party could
 * mint a valid Super Admin session. So resolution fails closed: an unset value,
 * the placeholder from `.env.example`, or anything under 32 characters throws
 * rather than degrading.
 *
 * Resolved lazily and cached: at module scope this would run before the
 * environment is loaded in some runtimes, and would surface as an unrelated
 * import error rather than as the configuration fault it is.
 */
let cachedKey: Uint8Array | null = null;

function signingKey(): Uint8Array {
  if (!cachedKey) {
    cachedKey = new TextEncoder().encode(requireSecret('SESSION_SECRET', { minLength: 32 }));
  }
  return cachedKey;
}

export async function encryptJwt(payload: Record<string, unknown>, expiresIn: string) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

export async function decryptJwt<T = any>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * The claims inside a token, **without verifying it**.
 *
 * For the one question a verified read cannot answer: which session an already
 * expired access token belonged to. Nothing here may be trusted as authority —
 * a caller writes whatever it likes into an unverified token — so use it only
 * to correlate against something that has been verified, never to authorise.
 */
export function readJwtClaims<T = any>(token: string): T | null {
  try {
    return decodeJwt(token) as T;
  } catch {
    return null;
  }
}

/** A session identifier. Always from the CSPRNG — see `lib/random.ts`. */
export function uuid() {
  return secureUuid();
}

export function expiryFromDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function expiryFromMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}
