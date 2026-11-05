import { createHash, randomBytes } from 'node:crypto';
import prisma from './prisma';
import { hashPassword, validatePassword } from './admin-users';
import { createAuditLog } from './audit-log';
import { sendWithSavedSettings } from './email';
import { activationEmail, passwordResetEmail } from './email-templates';
import { maskEmail } from './format';
import { revokeAllUserSessions } from './session';
import { getSetting } from './settings';

/**
 * Activation and password-reset links for admin accounts.
 *
 * Nobody chooses an admin's password but the admin. A new account starts with
 * none, and an invitation emailed to its holder's own address carries a link
 * through which they set one. An administrator's reset works the same way —
 * the old password stops working at once and the holder sets a new one through
 * the link — and so does "Forgot password" on the sign-in page, which leaves
 * the old password working until the link is used. No password is generated,
 * sent or seen by anybody else, and nothing about it goes by SMS.
 *
 * What makes a link safe to put in an email:
 *   - it carries 256 random bits, and only their SHA-256 is stored, so the
 *     table cannot be turned back into working links;
 *   - one link per account is live at a time: issuing one removes the rest;
 *   - redeeming it is a single conditional update, so it works exactly once
 *     however many requests race for it;
 *   - it expires, after the lifetimes under Settings → Security & Governance;
 *   - the token rides in the URL fragment, which a browser never sends to a
 *     server, so it cannot land in an access log or a Referer header;
 *   - the link is built from the console address saved under Users → Email,
 *     never from the request's Host header, which the caller controls.
 */

export const ACCOUNT_LINK_PURPOSES = ['ACTIVATION', 'PASSWORD_RESET'] as const;
export type AccountLinkPurpose = (typeof ACCOUNT_LINK_PURPOSES)[number];

/** One sentence for every way a link can be dead: whoever holds one needs a new one either way. */
export const DEAD_LINK = 'This link is invalid, has already been used or has expired.';

/** 32 bytes from the CSPRNG, base64url: 43 URL-safe characters. */
export function newAccountToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What is stored in place of the token. */
export function hashAccountToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The exact shape `newAccountToken` produces, so junk never reaches the database. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * The page a link opens. The token goes after `#`, the one part of a URL a
 * browser keeps to itself: the page reads it, takes it out of the address bar,
 * and posts it.
 */
export function accountLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/admin/set-password#token=${token}`;
}

/** Whether a stored link can still be redeemed. */
export function isLive(
  link: { purpose: string; expiresAt: Date; usedAt: Date | null; user: { status: string } },
  now: Date
): boolean {
  return (
    (ACCOUNT_LINK_PURPOSES as readonly string[]).includes(link.purpose) &&
    !link.usedAt &&
    link.expiresAt > now &&
    link.user.status === 'ACTIVE'
  );
}

/** How long a link of this kind stays usable, from Settings. */
export async function linkLifetimeMinutes(purpose: AccountLinkPurpose): Promise<number> {
  if (purpose === 'ACTIVATION') {
    const hours = Number(await getSetting('security.activationLinkHours'));
    return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60;
  }
  const minutes = Number(await getSetting('security.passwordResetLinkMinutes'));
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

export interface LinkHolder {
  id: string;
  fullName: string;
  email: string;
}

export interface SendLinkOutcome {
  purpose: AccountLinkPurpose;
  /** The email went out — or, with email in testing mode, was saved to the folder. */
  sent: boolean;
  expiresAt: Date;
  /** Testing mode: the .eml file the message was written to instead of being sent. */
  savedTo?: string;
  /** Why the email did not go out. Never contains the token. */
  error?: string;
}

/**
 * Issues a fresh link and emails it to the account's own address. Every link
 * issued before stops working, whether or not this one is delivered — after a
 * failure the next move is to fix email and send again, and an older link
 * must not outlive that.
 *
 * `issuedById` is the administrator sending it, or null when the holder asked
 * for it themselves; the reset email words itself accordingly.
 */
export async function sendAccountLink(
  holder: LinkHolder,
  purpose: AccountLinkPurpose,
  { issuedById }: { issuedById: string | null }
): Promise<SendLinkOutcome> {
  const minutes = await linkLifetimeMinutes(purpose);
  const token = newAccountToken();
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  await prisma.$transaction([
    prisma.accountToken.deleteMany({ where: { userId: holder.id } }),
    prisma.accountToken.create({
      data: {
        userId: holder.id,
        purpose,
        tokenHash: hashAccountToken(token),
        expiresAt,
        issuedById,
      },
    }),
  ]);

  const result = await sendWithSavedSettings((settings) => {
    const content = {
      brand: settings.fromName,
      fullName: holder.fullName,
      email: holder.email,
      link: accountLinkUrl(settings.appUrl, token),
      minutes,
    };
    const message =
      purpose === 'ACTIVATION'
        ? activationEmail(content)
        : passwordResetEmail({ ...content, initiatedByAdmin: issuedById !== null });
    return { to: holder.email, toName: holder.fullName, ...message };
  });

  return result.ok
    ? { purpose, sent: true, expiresAt, savedTo: result.savedTo }
    : { purpose, sent: false, expiresAt, error: result.error.split(token).join('[redacted]') };
}

/** What the Users screen is told about a link it asked for. The token is never part of it. */
export interface AccountLinkReport {
  purpose: AccountLinkPurpose;
  sent: boolean;
  email: string;
  expiresAt: string;
  /** Email is in testing mode: the message is in this file on the server, not in a mailbox. */
  savedTo: string | null;
  /** Why it was not sent — what a Super Admin needs to put email right. */
  error: string | null;
}

export function accountLinkReport(outcome: SendLinkOutcome, email: string): AccountLinkReport {
  return {
    purpose: outcome.purpose,
    sent: outcome.sent,
    email: maskEmail(email),
    expiresAt: outcome.expiresAt.toISOString(),
    savedTo: outcome.savedTo ?? null,
    error: outcome.error ?? null,
  };
}

/** The fields of an audit row about a link: whether it went, and until when it works. */
export function linkAuditDetails(outcome: SendLinkOutcome) {
  return {
    link: outcome.purpose,
    linkSent: outcome.sent,
    linkExpiresAt: outcome.expiresAt.toISOString(),
    linkSavedToTestFolder: Boolean(outcome.savedTo),
    linkError: outcome.error ?? null,
  };
}

export interface LiveLink {
  purpose: AccountLinkPurpose;
  expiresAt: Date;
  holder: LinkHolder;
}

const LINK_HOLDER = { select: { id: true, fullName: true, email: true, status: true } } as const;

/**
 * The live link behind a token, or null: unknown, already used, expired, or
 * for an account that is no longer active.
 */
export async function findLiveLink(token: unknown): Promise<LiveLink | null> {
  if (!isWellFormedToken(token)) return null;

  const link = await prisma.accountToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    include: { user: LINK_HOLDER },
  });
  if (!link || !isLive(link, new Date())) return null;

  return {
    purpose: link.purpose as AccountLinkPurpose,
    expiresAt: link.expiresAt,
    holder: { id: link.user.id, fullName: link.user.fullName, email: link.user.email },
  };
}

export type CompleteLinkResult =
  | { ok: true; purpose: AccountLinkPurpose; holder: LinkHolder }
  | { ok: false; error: string; field?: 'password' | 'confirmPassword' };

/**
 * Redeems a link with the password its holder chose. The link is spent, the
 * account can be signed in to with that password, any lockout is lifted — the
 * holder has just shown they own the mailbox — and every session the account
 * had is signed out.
 */
export async function completeAccountLink(input: {
  token: unknown;
  password: string;
  confirmPassword: string;
}): Promise<CompleteLinkResult> {
  // A dead link is reported before anything about the password: whoever holds
  // it needs a new link, not a better password.
  if (!(await findLiveLink(input.token))) return { ok: false, error: DEAD_LINK };

  const policy = validatePassword(input.password);
  if (!policy.ok) return { ok: false, error: policy.error, field: 'password' };
  if (input.password !== input.confirmPassword) {
    return { ok: false, error: 'The passwords do not match.', field: 'confirmPassword' };
  }

  // Hashed before the transaction opens: bcrypt is the slow part, and nothing
  // about it depends on the link.
  const passwordHash = await hashPassword(input.password);
  const tokenHash = hashAccountToken(input.token as string);
  const now = new Date();

  const redeemed = await prisma.$transaction(async (tx) => {
    const link = await tx.accountToken.findUnique({ where: { tokenHash }, include: { user: LINK_HOLDER } });
    if (!link || !isLive(link, now)) return null;

    // Claiming and checking are one statement, so of two requests racing with
    // the same link only one can get past here.
    const claimed = await tx.accountToken.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    await tx.user.update({
      where: { id: link.userId },
      data: {
        password: passwordHash,
        passwordChangeRequired: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    return link;
  });

  if (!redeemed) return { ok: false, error: DEAD_LINK };

  await revokeAllUserSessions(redeemed.userId);
  return {
    ok: true,
    purpose: redeemed.purpose as AccountLinkPurpose,
    holder: { id: redeemed.user.id, fullName: redeemed.user.fullName, email: redeemed.user.email },
  };
}

/**
 * "Forgot password" from the sign-in page. Runs after the response has gone,
 * so neither the answer nor how long it took says whether the address belongs
 * to an account.
 *
 * Only an active account that can sign in today is sent a link. One still
 * waiting on its invitation, or on an administrator's reset, is the
 * administrator's to send again — a request from the sign-in page must not
 * be able to wake up an account somebody deliberately left waiting.
 */
export async function requestPasswordReset(
  email: string,
  meta: { ipAddress: string | null; userAgent: string | null }
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, fullName: true, email: true, status: true, password: true },
  });

  if (!user || user.status !== 'ACTIVE' || !user.password) {
    await createAuditLog({
      actorId: email,
      actorType: 'ADMIN',
      action: 'PASSWORD_RESET_REQUESTED',
      details: { outcome: 'No account that can sign in uses this address; nothing was sent.' },
      ...meta,
    });
    return;
  }

  const outcome = await sendAccountLink(user, 'PASSWORD_RESET', { issuedById: null });
  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'PASSWORD_RESET_REQUESTED',
    entity: 'User',
    entityId: user.id,
    details: linkAuditDetails(outcome),
    ...meta,
  });
}
