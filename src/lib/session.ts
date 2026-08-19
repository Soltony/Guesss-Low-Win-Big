import { cookies } from 'next/headers';
import prisma from './prisma';
import {
  ACCESS_TOKEN_EXP,
  ACCESS_TOKEN_MINUTES,
  REFRESH_TOKEN_DAYS,
  decryptJwt,
  encryptJwt,
  expiryFromDays,
  expiryFromMinutes,
  uuid,
} from './jwt';
import { parsePermissions } from './permissions';
import type { SessionUser } from './types';

export const ACCESS_COOKIE = 'accessToken';
export const REFRESH_COOKIE = 'refreshToken';
export const MINIAPP_COOKIE = 'bidderSession';

/**
 * Cookies are marked Secure everywhere except an explicitly local run.
 *
 * Testing `NODE_ENV === 'production'` puts the burden the wrong way round: a
 * deployment that forgets to set it ships session cookies that travel in the
 * clear, and nothing about the running app looks wrong. Defaulting to Secure
 * means the only way to get a plain-HTTP cookie is to say so.
 */
function isLocalRuntime() {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/**
 * Administrative cookies are SameSite=Strict.
 *
 * Lax still accompanies a cross-site top-level navigation, which is enough for
 * an attacker's page to drive an authenticated GET into the console. Nothing
 * legitimately enters the admin surface from another site, so Strict costs
 * nothing here.
 */
const adminCookieBase = {
  httpOnly: true,
  secure: !isLocalRuntime(),
  sameSite: 'strict' as const,
  path: '/',
};

/**
 * The bidder cookie stays Lax, deliberately.
 *
 * The mini-app is entered by the super app navigating the webview to `/connect`
 * — a cross-site top-level navigation. Under Strict the cookie would be
 * withheld on exactly that hop and every deep link would bounce back through a
 * fresh token exchange. It is HttpOnly and Secure, it carries no privileged
 * capability, and the server-side origin check in `src/proxy.ts` covers the
 * state-changing requests that SameSite would otherwise be alone in guarding.
 */
const bidderCookieBase = {
  httpOnly: true,
  secure: !isLocalRuntime(),
  sameSite: 'lax' as const,
  path: '/',
};

// --------------------------------------
// SESSION LIFETIME
// --------------------------------------

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * How long a session may sit unused before it is revoked.
 *
 * Rotation used to extend the expiry on every refresh, so an active session —
 * including one being driven by a stolen token — never expired at all. These
 * two limits are what bound it: idle time since the last request, and total
 * time since sign-in. Both are configurable, both are clamped, so a typo in the
 * environment cannot widen them to something meaningless.
 */
export function idleTimeoutMs(): number {
  const configured = Number(process.env.SESSION_IDLE_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : 30;
  return clamp(minutes, 5, 240) * 60_000;
}

export function absoluteLifetimeMs(): number {
  const configured = Number(process.env.SESSION_ABSOLUTE_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : 8;
  return clamp(hours, 1, 72) * 60 * 60_000;
}

/** Why a session was refused, or null when it is still within both limits. */
export function sessionLifetimeBreach(record: {
  createdAt: Date;
  lastActivity: Date;
}): 'idle' | 'absolute' | null {
  const now = Date.now();
  if (now - record.lastActivity.getTime() > idleTimeoutMs()) return 'idle';
  if (now - record.createdAt.getTime() > absoluteLifetimeMs()) return 'absolute';
  return null;
}

async function revokeSession(id: string, reason: string) {
  await prisma.session
    .update({ where: { id }, data: { revoked: true, jti: null } })
    .catch(() => null);
  console.warn(`[session] revoked ${id}: ${reason}`);
}

// --------------------------------------
// ADMIN SESSIONS (DB-backed, rotating refresh token)
// --------------------------------------

export async function createAdminSession(
  userId: string,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found during session creation.');

  // The refresh token never outlives the absolute session cap, whatever
  // REFRESH_TOKEN_DAYS says — the cap is the shorter of the two by design.
  const refreshExpiresAt = new Date(
    Math.min(expiryFromDays(REFRESH_TOKEN_DAYS).getTime(), Date.now() + absoluteLifetimeMs())
  );
  const refreshToken = await encryptJwt({ userId, t: 'refresh' }, `${REFRESH_TOKEN_DAYS}d`);
  const jti = uuid();

  // One active session per user: logging in elsewhere revokes the old one.
  const record = await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, jti: null },
    });
    return tx.session.create({
      data: {
        userId,
        refreshToken,
        jti,
        expiresAt: refreshExpiresAt,
        revoked: false,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent?.slice(0, 1000) ?? undefined,
      },
    });
  });

  const accessToken = await encryptJwt(
    {
      userId,
      sessionId: record.id,
      jti,
      passwordChangeRequired: user.passwordChangeRequired,
    },
    ACCESS_TOKEN_EXP
  );

  const store = await cookies();
  store.set(ACCESS_COOKIE, accessToken, {
    ...adminCookieBase,
    expires: expiryFromMinutes(ACCESS_TOKEN_MINUTES),
  });
  store.set(REFRESH_COOKIE, refreshToken, { ...adminCookieBase, expires: refreshExpiresAt });

  return { accessToken, refreshToken, sessionId: record.id };
}

interface AccessPayload {
  userId: string;
  sessionId: string;
  jti?: string | null;
  passwordChangeRequired?: boolean;
}

/**
 * Resolves the current admin session.
 * `allowRefresh: false` validates without rotating or writing cookies — required
 * from Server Components, where cookie mutation throws.
 */
export async function getAdminSession(options?: {
  allowRefresh?: boolean;
}): Promise<AccessPayload | null> {
  const allowRefresh = options?.allowRefresh !== false;
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  const refresh = store.get(REFRESH_COOKIE)?.value;

  if (access) {
    const payload = await decryptJwt<AccessPayload>(access);
    if (payload?.userId && payload?.sessionId) {
      const record = await prisma.session.findUnique({ where: { id: payload.sessionId } });
      const valid =
        record &&
        !record.revoked &&
        record.expiresAt > new Date() &&
        record.userId === payload.userId;

      if (valid) {
        // The access token must carry the JTI currently bound to the session,
        // and the caller must hold the matching refresh cookie. Either check
        // failing means a token was swapped in from somewhere else.
        if (payload.jti && record.jti && payload.jti !== record.jti) return null;
        if (!refresh || refresh !== record.refreshToken) return null;

        const breach = sessionLifetimeBreach(record);
        if (breach) {
          await revokeSession(record.id, `${breach} limit exceeded`);
          return null;
        }

        await prisma.session.update({
          where: { id: record.id },
          data: { lastActivity: new Date() },
        });
        return payload;
      }
    }
  }

  if (!refresh) return null;

  const record = await prisma.session.findUnique({ where: { refreshToken: refresh } });
  if (!record || record.revoked || record.expiresAt < new Date()) return null;

  const breach = sessionLifetimeBreach(record);
  if (breach) {
    await revokeSession(record.id, `${breach} limit exceeded`);
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) return null;

  if (!allowRefresh) {
    await prisma.session.update({
      where: { id: record.id },
      data: { lastActivity: new Date() },
    });
    return {
      userId: record.userId,
      sessionId: record.id,
      jti: record.jti,
      passwordChangeRequired: user.passwordChangeRequired,
    };
  }

  // Rotate both tokens on every refresh.
  const newRefresh = await encryptJwt(
    { userId: record.userId, t: 'refresh' },
    `${REFRESH_TOKEN_DAYS}d`
  );
  const newJti = uuid();
  // Rotation renews the token, not the session: the new expiry is still capped
  // at the original sign-in plus the absolute lifetime, so refreshing forever
  // cannot keep a session alive forever.
  const absoluteDeadline = record.createdAt.getTime() + absoluteLifetimeMs();
  const refreshExpiresAt = new Date(
    Math.min(expiryFromDays(REFRESH_TOKEN_DAYS).getTime(), absoluteDeadline)
  );

  await prisma.session.update({
    where: { id: record.id },
    data: {
      refreshToken: newRefresh,
      jti: newJti,
      expiresAt: refreshExpiresAt,
      lastActivity: new Date(),
    },
  });

  const payload: AccessPayload = {
    userId: record.userId,
    sessionId: record.id,
    jti: newJti,
    passwordChangeRequired: user.passwordChangeRequired,
  };
  const newAccess = await encryptJwt({ ...payload }, ACCESS_TOKEN_EXP);

  store.set(ACCESS_COOKIE, newAccess, {
    ...adminCookieBase,
    expires: expiryFromMinutes(ACCESS_TOKEN_MINUTES),
  });
  store.set(REFRESH_COOKIE, newRefresh, { ...adminCookieBase, expires: refreshExpiresAt });

  return payload;
}

/** The session plus the authoritative role/permissions, always read fresh from the DB. */
export async function getCurrentUser(options?: {
  allowRefresh?: boolean;
}): Promise<SessionUser | null> {
  const session = await getAdminSession(options);
  if (!session?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (!user || user.status !== 'ACTIVE') return null;

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    status: user.status,
    role: user.role.name,
    roleId: user.roleId,
    permissions: parsePermissions(user.role.permissions),
    passwordChangeRequired: user.passwordChangeRequired,
  };
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true, jti: null },
  });
}

export async function deleteAdminSession() {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  const access = store.get(ACCESS_COOKIE)?.value;

  if (refresh) {
    const record = await prisma.session.findUnique({ where: { refreshToken: refresh } });
    if (record) {
      await prisma.session.update({
        where: { id: record.id },
        data: { revoked: true, jti: null },
      });
    }
  } else if (access) {
    const payload = await decryptJwt<AccessPayload>(access);
    if (payload?.sessionId) {
      await prisma.session
        .update({ where: { id: payload.sessionId }, data: { revoked: true, jti: null } })
        .catch(() => null);
    }
  }

  const expired = new Date(0);
  store.set(ACCESS_COOKIE, '', { ...adminCookieBase, expires: expired });
  store.set(REFRESH_COOKIE, '', { ...adminCookieBase, expires: expired });
}

// --------------------------------------
// MINI-APP SESSIONS (super-app token)
// --------------------------------------

export interface BidderSessionPayload {
  bidderId: string;
  phone: string;
  superAppToken: string;
  /**
   * Session was created through the authorization bypass. Carried in the signed
   * cookie so it cannot be forged, and checked wherever real money would move.
   */
  isTest?: boolean;
  /**
   * Identifies this sign-in. Anything that should happen once per login rather
   * than once per page — the ad popup — compares against it server-side, which
   * a webview's storage quirks cannot influence.
   */
  sid?: string;
}

/**
 * The bidder cookie's lifetime.
 *
 * Shorter than the previous day-long window: the token inside is the customer's
 * super-app credential, and the webview can always re-exchange it silently, so
 * there is no reason to hold one for longer than a shopping session.
 */
export function bidderSessionHours(): number {
  const configured = Number(process.env.BIDDER_SESSION_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : 8;
  return clamp(hours, 1, 24);
}

export async function createBidderSession(payload: BidderSessionPayload) {
  const hours = bidderSessionHours();
  const expires = new Date(Date.now() + hours * 60 * 60_000);
  const jwt = await encryptJwt({ sid: uuid(), ...payload }, `${hours}h`);
  const store = await cookies();
  store.set(MINIAPP_COOKIE, jwt, { ...bidderCookieBase, expires });
  return jwt;
}

export async function getBidderSession(): Promise<BidderSessionPayload | null> {
  const store = await cookies();
  const raw = store.get(MINIAPP_COOKIE)?.value;
  if (!raw) return null;
  const payload = await decryptJwt<BidderSessionPayload>(raw);
  if (!payload?.bidderId) return null;
  // A real session always carries the super-app token; a test session has none.
  if (!payload.isTest && !payload.superAppToken) return null;
  // The bypass mints a session with no credential behind it. Honouring one on a
  // deployment where the bypass has since been switched off would let a cookie
  // issued during testing keep working in production.
  if (payload.isTest && process.env.ALLOW_TEST_LOGIN !== 'true') return null;
  return payload;
}

export async function deleteBidderSession() {
  const store = await cookies();
  store.set(MINIAPP_COOKIE, '', { ...bidderCookieBase, expires: new Date(0) });
}
