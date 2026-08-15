/**
 * Authoritative route → permission registry.
 *
 * Deliberately free of React and icon imports so the Edge middleware can use it
 * without pulling the UI layer into the Edge bundle. `menu-items.ts` decorates
 * these same entries with icons for the sidebar.
 */

export interface AdminRoute {
  path: string;
  label: string;
  /** Role names allowed here on top of the module permission check. */
  roles?: string[];
}

export const ADMIN_ROUTES: AdminRoute[] = [
  { path: '/admin', label: 'Dashboard' },
  { path: '/admin/auctions', label: 'Auctions' },
  { path: '/admin/bids', label: 'Bids' },
  { path: '/admin/winners', label: 'Winners' },
  { path: '/admin/payments', label: 'Payments' },
  { path: '/admin/items', label: 'Items' },
  { path: '/admin/categories', label: 'Categories' },
  { path: '/admin/content', label: 'Content' },
  { path: '/admin/bidders', label: 'Bidders' },
  { path: '/admin/notifications', label: 'Notifications' },
  { path: '/admin/approvals', label: 'Approvals' },
  { path: '/admin/reports', label: 'Reports' },
  { path: '/admin/audit-logs', label: 'Audit Logs', roles: ['Super Admin', 'Auditor', 'Compliance'] },
  { path: '/admin/users', label: 'Users', roles: ['Super Admin'] },
  { path: '/admin/access-control', label: 'Access Control', roles: ['Super Admin'] },
  { path: '/admin/settings', label: 'Settings' },
];

export function moduleKeyFor(label: string) {
  return label.toLowerCase().replace(/\s+/g, '-');
}

export const MODULE_KEYS = ADMIN_ROUTES.map((r) => moduleKeyFor(r.label));

/** Pages any authenticated admin may open, whatever their permissions are. */
export const PERMISSION_EXEMPT_ROUTES = [
  '/admin/no-access',
  '/admin/change-password',
  '/admin/profile',
];

export const ADMIN_PUBLIC_ROUTES = ['/admin/login'];

/** Longest full-segment prefix match, so /admin/bids never matches /admin/bidders. */
export function findAdminRoute(path: string): AdminRoute | undefined {
  let best: AdminRoute | undefined;
  for (const route of ADMIN_ROUTES) {
    const exact = path === route.path;
    const segmentPrefix = path.startsWith(route.path + '/');
    if ((exact || segmentPrefix) && (!best || route.path.length > best.path.length)) {
      best = route;
    }
  }
  return best;
}

export const API_MODULE_MAP: Record<string, string> = {
  '/api/admin/auctions': 'auctions',
  '/api/admin/bids': 'bids',
  '/api/admin/winners': 'winners',
  '/api/admin/payments': 'payments',
  '/api/admin/items': 'items',
  '/api/admin/categories': 'categories',
  '/api/admin/content': 'content',
  // Saved participant lists are managed on the Content page, so they share its
  // module rather than introducing a permission every role would have to be
  // re-granted.
  '/api/admin/participant-lists': 'content',
  '/api/admin/bidders': 'bidders',
  '/api/admin/notifications': 'notifications',
  '/api/admin/approvals': 'approvals',
  '/api/admin/reports': 'reports',
  '/api/admin/audit-logs': 'audit-logs',
  '/api/admin/users': 'users',
  '/api/admin/roles': 'access-control',
  '/api/admin/settings': 'settings',
  '/api/admin/dashboard': 'dashboard',
};

export function moduleKeyForApiPath(path: string): string | undefined {
  let best: string | undefined;
  let bestLen = 0;
  for (const [prefix, key] of Object.entries(API_MODULE_MAP)) {
    if ((path === prefix || path.startsWith(prefix + '/')) && prefix.length > bestLen) {
      best = key;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Mini-app pages that require a super-app session.
 * Browsing (home, auction details) stays open so the super app can deep-link
 * into an item; anything personal or transactional needs the session.
 */
export const PROTECTED_MINIAPP_ROUTES = ['/my-bids', '/wins', '/profile'];
export const MINIAPP_PUBLIC_ROUTES = ['/connect', '/', '/how-it-works', '/auctions'];
