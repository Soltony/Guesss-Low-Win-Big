import { SignJWT, jwtVerify } from 'jose';

// Kept free of `next/headers` and Prisma imports so the Edge middleware can
// verify tokens without dragging Node-only code into the Edge bundle.

const secret = process.env.SESSION_SECRET || '';
const key = new TextEncoder().encode(secret);

export const ACCESS_TOKEN_EXP = '15m';
export const ACCESS_TOKEN_MINUTES = 15;
export const REFRESH_TOKEN_DAYS = 7;

export async function encryptJwt(payload: Record<string, unknown>, expiresIn: string) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function decryptJwt<T = any>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload as T;
  } catch {
    return null;
  }
}

export function uuid() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

export function expiryFromDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function expiryFromMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}
