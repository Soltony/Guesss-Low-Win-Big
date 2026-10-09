import { Mail, UserCog } from 'lucide-react';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { UsersManager, type EmailStatus } from '@/components/admin/users-manager';
import { EmailSettingsForm } from '@/components/admin/email-settings-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getEmailSettingsView } from '@/lib/email';
import { getSettings } from '@/lib/settings';
import type { AccountLinkPurpose } from '@/lib/account-links';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [user, users, roles, email, settings, params] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: { select: { id: true, name: true } },
        // An account has at most one link: for one without a password, what it is waiting on.
        accountTokens: { orderBy: { createdAt: 'desc' }, take: 1, select: { purpose: true, expiresAt: true } },
      },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    getEmailSettingsView(),
    getSettings(),
    searchParams,
  ]);
  const canUpdate = hasPermission(user, 'users', 'update');
  const now = new Date();

  const emailStatus: EmailStatus =
    !email.settings.enabled || email.problem
      ? 'unavailable'
      : email.settings.mode === 'PICKUP_FOLDER'
        ? 'testing'
        : 'ready';

  return (
    <>
      <PageHeader
        title="Users"
        description="Operations accounts. Each one is activated, and its password reset, through a link emailed to its holder."
      />
      <Tabs defaultValue={params.tab === 'email' ? 'email' : 'accounts'}>
        <TabsList>
          <TabsTrigger value="accounts">
            <UserCog className="mr-1.5 h-4 w-4" />
            Accounts
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="mr-1.5 h-4 w-4" />
            Email
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          <UsersManager
            currentUserId={user?.id ?? ''}
            roles={roles}
            canCreate={hasPermission(user, 'users', 'create')}
            canUpdate={canUpdate}
            emailStatus={emailStatus}
            linkLifetimes={{
              activationMinutes: (Number(settings['security.activationLinkHours']) || 24) * 60,
              resetMinutes: Number(settings['security.passwordResetLinkMinutes']) || 30,
            }}
            users={users.map((u) => {
              const link = u.accountTokens[0];
              return {
                id: u.id,
                fullName: u.fullName,
                email: u.email,
                phoneNumber: u.phoneNumber,
                status: u.status,
                roleId: u.roleId,
                roleName: u.role.name,
                passwordChangeRequired: u.passwordChangeRequired,
                lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
                locked: Boolean(u.lockedUntil && u.lockedUntil > now),
                hasPassword: u.password !== null,
                pendingLink:
                  u.password === null && link
                    ? {
                        purpose: link.purpose as AccountLinkPurpose,
                        expiresAt: link.expiresAt.toISOString(),
                        expired: link.expiresAt <= now,
                      }
                    : null,
              };
            })}
          />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <EmailSettingsForm initial={email} canUpdate={canUpdate} />
        </TabsContent>
      </Tabs>
    </>
  );
}
