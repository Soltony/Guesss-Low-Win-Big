import { NextRequest, NextResponse } from 'next/server';
import { isGuardFailure, jsonError, readJsonBody, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';
import {
  MAX_SMTP_PASSWORD_LENGTH,
  describeEmailSettings,
  emailSettingsFromInput,
  getEmailSettings,
  getEmailSettingsView,
  getSmtpPassword,
  sameSmtpAccount,
  saveEmailSettings,
  validateEmailSettings,
} from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('users', 'read');
  if (isGuardFailure(guard)) return guard.response;

  return NextResponse.json(await getEmailSettingsView());
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission('users', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const body = await readJsonBody(req, { secretFields: ['password'] });
  if (body instanceof NextResponse) return body;

  const settings = emailSettingsFromInput(body);
  // null keeps the stored password, '' removes it, anything else replaces it.
  const password = typeof body.password === 'string' ? body.password : null;
  if (password && password.length > MAX_SMTP_PASSWORD_LENGTH) {
    return jsonError('Password is too long.', 400, { field: 'password' });
  }

  const [current, stored] = await Promise.all([getEmailSettings(), getSmtpPassword()]);

  // A stored password stays with the server and account it was entered for.
  // Carried over to a new host, it would be handed to that host on first use.
  if (
    password === null &&
    stored.state === 'SET' &&
    settings.username &&
    !sameSmtpAccount(current, settings)
  ) {
    return jsonError(
      'You changed the SMTP server or username: re-enter the password for the new account.',
      400,
      { field: 'password' }
    );
  }

  const passwordAvailable = Boolean(password) || (password === null && stored.state === 'SET');
  const problem = validateEmailSettings(settings, {
    requirePassword: settings.enabled,
    passwordAvailable,
  });
  if (problem) return jsonError(problem, 400);

  await saveEmailSettings(settings, password, user.id);

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'EMAIL_SETTINGS_UPDATED',
    entity: 'SystemSetting',
    entityId: 'email.config',
    details: {
      before: describeEmailSettings(current),
      after: describeEmailSettings(settings),
      smtpPassword: password === null ? 'unchanged' : password ? 'replaced' : 'removed',
    },
  });

  return NextResponse.json(await getEmailSettingsView());
}
