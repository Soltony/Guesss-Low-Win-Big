import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { NotificationsManager } from '@/components/admin/notifications-manager';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const [user, templates, logs, counts, settings] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.notificationTemplate.findMany({ orderBy: { code: 'asc' } }),
    prisma.notificationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.notificationLog.groupBy({ by: ['status'], _count: { _all: true } }),
    getSettings(),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Message templates and the outbound delivery log."
      />

      {!settings['notifications.enabled'] && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Notifications are switched off globally in Settings → Notifications. Nothing will be
          sent until that is re-enabled.
        </div>
      )}

      <StatGrid>
        <StatCard label="Templates" value={templates.length} />
        <StatCard label="Active templates" value={templates.filter((t) => t.active).length} />
        <StatCard label="Sent" value={countByStatus.get('SENT') ?? 0} tone="success" />
        <StatCard label="Failed" value={countByStatus.get('FAILED') ?? 0} tone="destructive" />
        <StatCard label="Queued" value={countByStatus.get('QUEUED') ?? 0} tone="warning" />
      </StatGrid>

      <div className="mt-6">
        <NotificationsManager
          canUpdate={hasPermission(user, 'notifications', 'update')}
          templates={templates.map((template) => ({
            id: template.id,
            code: template.code,
            name: template.name,
            channel: template.channel,
            subject: template.subject ?? '',
            bodyEn: template.bodyEn,
            bodyAm: template.bodyAm ?? '',
            active: template.active,
          }))}
          logs={logs.map((log) => ({
            id: log.id,
            templateCode: log.templateCode,
            channel: log.channel,
            recipient: log.recipient,
            body: log.body,
            status: log.status,
            error: log.error,
            createdAt: log.createdAt.toISOString(),
            sentAt: log.sentAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </>
  );
}
