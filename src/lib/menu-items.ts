import {
  LayoutDashboard,
  Gavel,
  Package,
  LayoutGrid,
  ListOrdered,
  Users,
  Trophy,
  Wallet,
  CheckSquare,
  BellRing,
  Images,
  BarChart3,
  ShieldCheck,
  UserCog,
  Settings,
  BookUser,
  type LucideIcon,
} from 'lucide-react';
import { ADMIN_ROUTES, moduleKeyFor } from './route-permissions';

export { moduleKeyFor, MODULE_KEYS, findAdminRoute } from './route-permissions';

export type MenuGroup = 'Operations' | 'Catalog' | 'Customers' | 'Governance' | 'System';

export interface MenuItem {
  path: string;
  label: string;
  moduleKey: string;
  icon: LucideIcon;
  roles?: string[];
  group: MenuGroup;
}

const DECORATION: Record<string, { icon: LucideIcon; group: MenuGroup }> = {
  '/admin': { icon: LayoutDashboard, group: 'Operations' },
  '/admin/auctions': { icon: Gavel, group: 'Operations' },
  '/admin/bids': { icon: ListOrdered, group: 'Operations' },
  '/admin/winners': { icon: Trophy, group: 'Operations' },
  '/admin/payments': { icon: Wallet, group: 'Operations' },
  '/admin/items': { icon: Package, group: 'Catalog' },
  '/admin/categories': { icon: LayoutGrid, group: 'Catalog' },
  '/admin/content': { icon: Images, group: 'Catalog' },
  '/admin/bidders': { icon: Users, group: 'Customers' },
  '/admin/notifications': { icon: BellRing, group: 'Customers' },
  '/admin/approvals': { icon: CheckSquare, group: 'Governance' },
  '/admin/reports': { icon: BarChart3, group: 'Governance' },
  '/admin/audit-logs': { icon: BookUser, group: 'Governance' },
  '/admin/users': { icon: UserCog, group: 'System' },
  '/admin/access-control': { icon: ShieldCheck, group: 'System' },
  '/admin/settings': { icon: Settings, group: 'System' },
};

export const MENU_GROUP_ORDER: MenuGroup[] = [
  'Operations',
  'Catalog',
  'Customers',
  'Governance',
  'System',
];

export const allMenuItems: MenuItem[] = ADMIN_ROUTES.map((route) => ({
  ...route,
  moduleKey: moduleKeyFor(route.label),
  icon: DECORATION[route.path]?.icon ?? LayoutDashboard,
  group: DECORATION[route.path]?.group ?? 'Operations',
}));

export function findMenuItemForPath(path: string): MenuItem | undefined {
  let best: MenuItem | undefined;
  for (const item of allMenuItems) {
    const exact = path === item.path;
    const segmentPrefix = path.startsWith(item.path + '/');
    if ((exact || segmentPrefix) && (!best || item.path.length > best.path.length)) {
      best = item;
    }
  }
  return best;
}
