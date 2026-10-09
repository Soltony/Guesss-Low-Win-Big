import { NextRequest, NextResponse } from 'next/server';
import {
  isGuardFailure,
  jsonError,
  readJsonBody,
  requirePermission,
  tooManyRequests,
} from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import {
  MAX_SMTP_PASSWORD_LENGTH,
  describeEmailSettings,
  emailSettingsFromInput,
  getEmailSettings,
  getSmtpPassword,
  isEmailAddress,
  sameSmtpAccount,
  sendEmailWith,
} from '@/lib/email';
import { testEmail } from '@/lib/email-templates';
import { consumeRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Sends a test message. When the form's values come with the request they are
 * what is used, so a server can be tried before anything is saved.
 */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('users', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const limit = consumeRateLimit('emailTest', `account:${user.id}`);
  if (!limit.ok) {
    return tooManyRequests(
      limit.retryAfterSeconds,
      'Too many test emails. Wait a few minutes before trying again.'
    );
  }

  const body = await readJsonBody(req, { secretFields: ['settings.password'] });
  if (body instanceof NextResponse) return body;

  const to = String(body.to ?? '').trim() || user.email;
  if (!isEmailAddress(to)) {
    return jsonError('Enter the email address to send the test to.', 400, { field: 'to' });
  }

  const [saved, stored] = await Promise.all([getEmailSettings(), getSmtpPassword()]);
  const form =
    body.settings && typeof body.settings === 'object'
      ? (body.settings as Record<string, unknown>)
      : null;
  const settings = form ? emailSettingsFromInput(form) : saved;
  const typed = form && typeof form.password === 'string' ? form.password : '';
  if (typed.length > MAX_SMTP_PASSWORD_LENGTH) {
    return jsonError('Password is too long.', 400, { field: 'password' });
  }

  // The stored password only ever goes to the server and account it was saved
  // for. A form pointing somewhere else has to bring its own.
  let password: string | null;
  if (typed) {
    password = typed;
  } else if (!settings.username || settings.mode === 'PICKUP_FOLDER') {
    password = null;
  } else if (!sameSmtpAccount(saved, settings)) {
    return jsonError(
      'You changed the SMTP server or username: enter the password for the new account to test it.',
      400,
      { field: 'password' }
    );
  } else if (stored.state === 'UNREADABLE') {
    return jsonError(
      "The saved SMTP password can't be read on this server. Enter it again to test.",
      400,
      { field: 'password' }
    );
  } else {
    password = stored.password;
  }

  const message = testEmail({ brand: settings.fromName || 'GuessLow', fullName: user.fullName });
  const result = await sendEmailWith({ ...settings, enabled: true }, password, {
    to,
    // The greeting names whoever pressed the button; the display name only
    // belongs on the envelope when the message is going to them.
    toName: to.toLowerCase() === user.email.toLowerCase() ? user.fullName : undefined,
    ...message,
  });

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'EMAIL_TEST_SENT',
    entity: 'SystemSetting',
    entityId: 'email.config',
    details: {
      to,
      delivered: result.ok,
      via: describeEmailSettings(settings),
      error: result.ok ? null : result.error,
    },
  });

  if (!result.ok) return jsonError(result.error, 502);
  return NextResponse.json({ sentTo: to, savedTo: result.savedTo ?? null });
}
