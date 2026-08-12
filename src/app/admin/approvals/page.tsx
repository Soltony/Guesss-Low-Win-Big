import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { ApprovalsList } from '@/components/admin/approvals-list';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { PENDING_CHANGE_STATUSES } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = PENDING_CHANGE_STATUSES.includes(params.status as any)
    ? params.status!
    : 'PENDING';

  const [user, changes, counts] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.pendingChange.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    }),
    prisma.pendingChange.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Sensitive changes wait here for a second pair of eyes. You cannot approve your own request."
      />

      <StatGrid>
        <StatCard label="Pending" value={countByStatus.get('PENDING') ?? 0} tone="warning" />
        <StatCard label="Approved" value={countByStatus.get('APPROVED') ?? 0} tone="success" />
        <StatCard label="Rejected" value={countByStatus.get('REJECTED') ?? 0} tone="destructive" />
        <StatCard label="Withdrawn" value={countByStatus.get('CANCELLED') ?? 0} />
      </StatGrid>

      <div className="mt-6">
        <ApprovalsList
          currentUserId={user?.id ?? ''}
          canApprove={hasPermission(user, 'approvals', 'approve')}
          activeStatus={status}
          changes={changes.map((change) => ({
            id: change.id,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            summary: change.summary,
            status: change.status,
            comment: change.comment,
            payload: change.payload,
            previousData: change.previousData,
            changedFields: change.changedFields,
            createdBy: change.createdBy.fullName,
            createdById: change.createdBy.id,
            approvedBy: change.approvedBy?.fullName ?? null,
            createdAt: change.createdAt.toISOString(),
            decidedAt: change.decidedAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </>
  );
}
