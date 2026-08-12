import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { UsersManager } from '@/components/admin/users-manager';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

export default async function UsersPage() {
  const [user, users, roles] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { id: true, name: true } } },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Operations accounts. New accounts get a one-time password that must be changed at first sign-in."
      />
      <UsersManager
        currentUserId={user?.id ?? ''}
        roles={roles}
        canCreate={hasPermission(user, 'users', 'create')}
        canUpdate={hasPermission(user, 'users', 'update')}
        users={users.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phoneNumber: u.phoneNumber,
          status: u.status,
          roleId: u.roleId,
          roleName: u.role.name,
          passwordChangeRequired: u.passwordChangeRequired,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
        }))}
      />
    </>
  );
}
