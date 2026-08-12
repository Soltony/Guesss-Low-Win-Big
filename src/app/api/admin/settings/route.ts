import { NextRequest, NextResponse } from 'next/server';
import { isGuardFailure, jsonError, requirePermission } from '@/lib/api';
import {
  SETTINGS_BY_KEY,
  getSettings,
  setSetting,
  validateSettingValue,
} from '@/lib/settings';
import { createAuditLog } from '@/lib/audit-log';
import { requestChange, requiresApproval } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('settings', 'read');
  if (isGuardFailure(guard)) return guard.response;

  const values = await getSettings(true);
  return NextResponse.json({ values });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission('settings', 'update');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const body = await req.json().catch(() => ({}));
  const updates = body?.values;
  if (!updates || typeof updates !== 'object') {
    return jsonError('No settings supplied.', 400);
  }

  const current = await getSettings(true);
  const accepted: Record<string, string | number | boolean> = {};
  const previous: Record<string, string | number | boolean> = {};
  const sensitive: Record<string, string | number | boolean> = {};

  for (const [key, raw] of Object.entries(updates as Record<string, unknown>)) {
    const definition = SETTINGS_BY_KEY.get(key);
    if (!definition) return jsonError(`Unknown setting: ${key}`, 400);

    const validation = validateSettingValue(definition, raw);
    if (!validation.ok) return jsonError(validation.error, 400);

    // Skip no-op writes so the audit trail only shows real changes.
    if (current[key] === validation.value) continue;

    previous[key] = current[key];
    if (definition.sensitive) sensitive[key] = validation.value;
    else accepted[key] = validation.value;
  }

  if (Object.keys(accepted).length === 0 && Object.keys(sensitive).length === 0) {
    return NextResponse.json({ ok: true, changed: 0, message: 'No changes to apply.' });
  }

  // Sensitive keys can be routed through maker-checker; the rest apply now.
  let pendingChangeId: string | undefined;
  if (Object.keys(sensitive).length > 0 && (await requiresApproval('settings'))) {
    const change = await requestChange({
      entityType: 'SystemSetting',
      action: 'UPDATE',
      payload: sensitive,
      previousData: Object.fromEntries(
        Object.keys(sensitive).map((key) => [key, previous[key]])
      ),
      summary: `Update ${Object.keys(sensitive).length} sensitive setting(s)`,
      user,
    });
    pendingChangeId = change.id;
  } else {
    Object.assign(accepted, sensitive);
  }

  for (const [key, value] of Object.entries(accepted)) {
    await setSetting(key, value, user.id);
  }

  if (Object.keys(accepted).length > 0) {
    await createAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'SETTINGS_UPDATED',
      entity: 'SystemSetting',
      details: {
        changed: Object.keys(accepted),
        before: Object.fromEntries(Object.keys(accepted).map((k) => [k, previous[k]])),
        after: accepted,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    changed: Object.keys(accepted).length,
    pendingChangeId,
    pendingKeys: pendingChangeId ? Object.keys(sensitive) : [],
  });
}
