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

function isProd() {
  return process.env.NODE_ENV === 'production';
}

const cookieBase = {
  httpOnly: true,
  secure: isProd(),
  sameSite: 'lax' as const,
  path: '/',
};

// --------------------------------------
// ADMIN SESSIONS (DB-backed, rotating refresh token)
// --------------------------------------

export async function createAdminSession(
  userId: string,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found during session creation.');

  const refreshExpiresAt = expiryFromDays(REFRESH_TOKEN_DAYS);
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
    ...cookieBase,
    expires: expiryFromMinutes(ACCESS_TOKEN_MINUTES),
  });
  store.set(REFRESH_COOKIE, refreshToken, { ...cookieBase, expires: refreshExpiresAt });

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
  const refreshExpiresAt = expiryFromDays(REFRESH_TOKEN_DAYS);

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
    ...cookieBase,
    expires: expiryFromMinutes(ACCESS_TOKEN_MINUTES),
  });
  store.set(REFRESH_COOKIE, newRefresh, { ...cookieBase, expires: refreshExpiresAt });

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
  store.set(ACCESS_COOKIE, '', { ...cookieBase, expires: expired });
  store.set(REFRESH_COOKIE, '', { ...cookieBase, expires: expired });
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
}

export async function createBidderSession(payload: BidderSessionPayload) {
  const expires = expiryFromDays(1);
  const jwt = await encryptJwt({ ...payload }, '1d');
  const store = await cookies();
  store.set(MINIAPP_COOKIE, jwt, { ...cookieBase, expires });
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
  return payload;
}

export async function deleteBidderSession() {
  const store = await cookies();
  store.set(MINIAPP_COOKIE, '', { ...cookieBase, expires: new Date(0) });
}
