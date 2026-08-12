import { MODULE_KEYS } from './menu-items';
import type { PermissionAction, Permissions } from './types';

export const SUPER_ADMIN_ROLE = 'Super Admin';

export function parsePermissions(raw: unknown): Permissions {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Permissions;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Permissions) : {};
  } catch {
    return {};
  }
}

/** Every module granted with at least one action. */
export function grantedModules(permissions: Permissions): Set<string> {
  const set = new Set<string>();
  for (const [key, actions] of Object.entries(permissions || {})) {
    if (actions && Object.values(actions).some(Boolean)) set.add(key.toLowerCase());
  }
  return set;
}

export function hasPermission(
  user: { role?: string; permissions?: Permissions } | null | undefined,
  moduleKey: string,
  action: PermissionAction
): boolean {
  if (!user) return false;
  if (user.role === SUPER_ADMIN_ROLE) return true;
  return !!user.permissions?.[moduleKey?.toLowerCase()]?.[action];
}

/** A blank matrix with every module/action false — the starting point in the role builder. */
export function emptyPermissionMatrix(): Permissions {
  const out: Permissions = {};
  for (const key of MODULE_KEYS) {
    out[key] = { read: false, create: false, update: false, delete: false, approve: false };
  }
  return out;
}

export function fullPermissionMatrix(): Permissions {
  const out: Permissions = {};
  for (const key of MODULE_KEYS) {
    out[key] = { read: true, create: true, update: true, delete: true, approve: true };
  }
  return out;
}

/** Drops unknown module keys so a stale role can't grant access to something removed. */
export function sanitizePermissions(input: Permissions): Permissions {
  const out: Permissions = {};
  for (const key of MODULE_KEYS) {
    const actions = input?.[key];
    if (!actions) continue;
    out[key] = {
      read: !!actions.read,
      create: !!actions.create,
      update: !!actions.update,
      delete: !!actions.delete,
      approve: !!actions.approve,
    };
  }
  return out;
}

/** First admin page the user is allowed to open — used for post-login landing. */
export function firstAllowedPath(
  permissions: Permissions,
  role: string,
  paths: { path: string; moduleKey: string }[]
): string {
  if (role === SUPER_ADMIN_ROLE) return '/admin';
  const granted = grantedModules(permissions);
  const match = paths.find((p) => granted.has(p.moduleKey));
  return match?.path ?? '/admin/no-access';
}
