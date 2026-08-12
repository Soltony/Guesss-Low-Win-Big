import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { AdminShell } from '@/components/admin/admin-shell';
import { allMenuItems } from '@/lib/menu-items';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/** Routes that render their own full-page chrome instead of the admin shell. */
const BARE_ROUTES = ['/admin/login', '/admin/change-password'];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') || headerList.get('x-invoke-path');

  // `x-pathname` is stamped by src/proxy.ts. Without it we cannot tell the bare
  // auth screens apart from the shell routes, so we render bare rather than
  // redirect — redirecting blindly would bounce /admin/login to itself forever.
  // Each page still enforces its own permissions, and the proxy is the real guard.
  if (!pathname) return <>{children}</>;

  // The login and change-password screens are reachable without a usable
  // session, so they must not go through the shell's redirect.
  if (BARE_ROUTES.some((route) => pathname.startsWith(route))) {
    return <>{children}</>;
  }

  const user = await getCurrentUser({ allowRefresh: false });
  if (!user) redirect('/admin/login');
  if (user.passwordChangeRequired) redirect('/admin/change-password');

  const visibleItems = allMenuItems
    .filter((item) => hasPermission(user, item.moduleKey, 'read'))
    .filter(
      (item) =>
        !item.roles?.length ||
        item.roles.some((role) => role.toLowerCase() === user.role.toLowerCase())
    )
    .map(({ path, label, moduleKey, group }) => ({ path, label, moduleKey, group }));

  const pendingApprovals = hasPermission(user, 'approvals', 'read')
    ? await prisma.pendingChange.count({
        where: { status: 'PENDING', NOT: { createdById: user.id } },
      })
    : 0;

  return (
    <AdminShell
      user={{ id: user.id, fullName: user.fullName, email: user.email, role: user.role }}
      items={visibleItems}
      pendingApprovals={pendingApprovals}
    >
      {children}
    </AdminShell>
  );
}
