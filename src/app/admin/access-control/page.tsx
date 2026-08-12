import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { RoleBuilder } from '@/components/admin/role-builder';
import { getCurrentUser } from '@/lib/session';
import { hasPermission, parsePermissions } from '@/lib/permissions';
import { allMenuItems } from '@/lib/menu-items';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access Control' };

export default async function AccessControlPage() {
  const [user, roles] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Access Control"
        description="Roles define which modules a user can open and what they may do there. Super Admin always has full access."
      />
      <RoleBuilder
        modules={allMenuItems.map((item) => ({
          key: item.moduleKey,
          label: item.label,
          group: item.group,
        }))}
        roles={roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description ?? '',
          isSystem: role.isSystem,
          userCount: role._count.users,
          permissions: parsePermissions(role.permissions),
        }))}
        canCreate={hasPermission(user, 'access-control', 'create')}
        canUpdate={hasPermission(user, 'access-control', 'update')}
        canDelete={hasPermission(user, 'access-control', 'delete')}
      />
    </>
  );
}
