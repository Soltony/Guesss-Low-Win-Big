/**
 * Authoritative route → permission registry.
 *
 * Deliberately free of React and icon imports so the Edge middleware can use it
 * without pulling the UI layer into the Edge bundle. `menu-items.ts` decorates
 * these same entries with icons for the sidebar.
 */

/** A tab on a page that carries its own permissions, granted as `parent.tab`. */
export interface SubModule {
  /** Matches the tab's `value` in the page's `<Tabs>`. */
  tab: string;
  label: string;
}

export interface AdminRoute {
  path: string;
  label: string;
  /** Role names allowed here on top of the module permission check. */
  roles?: string[];
  /**
   * Tabs that are permissioned separately (`content.banners`). They never reach
   * the sidebar — the parent module still decides who may open the page at all,
   * and the tabs decide what they see once they are on it.
   */
  subModules?: SubModule[];
}

export const ADMIN_ROUTES: AdminRoute[] = [
  { path: '/admin', label: 'Dashboard' },
  { path: '/admin/auctions', label: 'Auctions' },
  { path: '/admin/bids', label: 'Bids' },
  { path: '/admin/winners', label: 'Winners' },
  { path: '/admin/payments', label: 'Payments' },
  { path: '/admin/items', label: 'Items' },
  { path: '/admin/categories', label: 'Categories' },
  {
    path: '/admin/content',
    label: 'Content',
    subModules: [
      { tab: 'banners', label: 'Banners' },
      { tab: 'ads', label: 'Ads' },
      { tab: 'terms', label: 'Terms & conditions' },
      { tab: 'participant-lists', label: 'Participant lists' },
      { tab: 'branding', label: 'Branding' },
    ],
  },
  { path: '/admin/bidders', label: 'Bidders' },
  {
    path: '/admin/notifications',
    label: 'Notifications',
    subModules: [
      { tab: 'templates', label: 'Templates' },
      { tab: 'logs', label: 'Delivery log' },
    ],
  },
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

/** `content` + `banners` → `content.banners`. */
export function subModuleKey(parentKey: string, tab: string) {
  return `${parentKey}.${tab}`;
}

/** The page-level module a key belongs to. A parent key resolves to itself. */
export function parentModuleKey(key: string) {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

export function subModulesFor(parentKey: string): SubModule[] {
  return ADMIN_ROUTES.find((route) => moduleKeyFor(route.label) === parentKey)?.subModules ?? [];
}

/** Page-level modules only — what the sidebar and the proxy gate on. */
export const PARENT_MODULE_KEYS = ADMIN_ROUTES.map((r) => moduleKeyFor(r.label));

/**
 * Every key a role may be granted: each module followed by its tabs.
 * `sanitizePermissions` drops anything missing here, so a new sub-module only
 * becomes grantable once it is listed on its route above.
 */
export const MODULE_KEYS = ADMIN_ROUTES.flatMap((route) => {
  const key = moduleKeyFor(route.label);
  return [key, ...(route.subModules ?? []).map((sub) => subModuleKey(key, sub.tab))];
});

/**
 * `/api/admin/content` is a single endpoint discriminated by `kind` in the
 * payload, which the proxy cannot read — the handlers resolve the tab module
 * themselves once the body is parsed.
 */
export const CONTENT_KIND_MODULES: Record<string, string> = {
  banner: 'content.banners',
  ad: 'content.ads',
  terms: 'content.terms',
};

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
 * Browsing (auction list and details) stays open so the super app can deep-link
 * into an item; anything personal or transactional needs the session. The home
 * route `/` is gated separately in the proxy — it is the site's front door, so
 * without a bidder cookie it goes to the admin login rather than the mini-app.
 */
export const PROTECTED_MINIAPP_ROUTES = ['/my-bids', '/wins', '/profile'];
export const MINIAPP_PUBLIC_ROUTES = ['/connect', '/', '/how-it-works', '/auctions'];
