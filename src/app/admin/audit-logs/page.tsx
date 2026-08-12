import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuditDetails } from '@/components/admin/audit-details';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit Logs' };

const PAGE_SIZE = 40;

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    action?: string;
    entity?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const from = params.from ? new Date(params.from) : undefined;
  const to = params.to ? new Date(`${params.to}T23:59:59.999`) : undefined;

  const where: any = {
    ...(params.action ? { action: { contains: params.action } } : {}),
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.q
      ? {
          OR: [
            { actorId: { contains: params.q } },
            { actorName: { contains: params.q } },
            { entityId: { contains: params.q } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [logs, total, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      where: { entity: { not: null } },
      take: 50,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every privileged action, external call and money movement, oldest data first retained indefinitely."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/api/admin/audit-logs/export" prefetch={false}>
              Export CSV
            </Link>
          </Button>
        }
      />

      <FilterBar>
        <div className="min-w-[180px] flex-1">
          <Label htmlFor="q" className="text-xs">
            Actor or record id
          </Label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="User, phone or id" />
        </div>
        <div className="min-w-[150px]">
          <Label htmlFor="action" className="text-xs">
            Action contains
          </Label>
          <Input id="action" name="action" defaultValue={params.action} placeholder="SETTLED" />
        </div>
        <div className="min-w-[150px]">
          <Label htmlFor="entity" className="text-xs">
            Entity
          </Label>
          <select
            id="entity"
            name="entity"
            defaultValue={params.entity ?? ''}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All entities</option>
            {entities
              .map((row) => row.entity)
              .filter(Boolean)
              .sort()
              .map((entity) => (
                <option key={entity} value={entity!}>
                  {entity}
                </option>
              ))}
          </select>
        </div>
        <div>
          <Label htmlFor="from" className="text-xs">
            From
          </Label>
          <Input id="from" name="from" type="date" defaultValue={params.from} />
        </div>
        <div>
          <Label htmlFor="to" className="text-xs">
            To
          </Label>
          <Input id="to" name="to" type="date" defaultValue={params.to} />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/audit-logs">Reset</Link>
        </Button>
      </FilterBar>

      <TableCard>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Actor</th>
              <th className="px-4 py-2.5 font-semibold">Action</th>
              <th className="px-4 py-2.5 font-semibold">Record</th>
              <th className="px-4 py-2.5 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 && <EmptyRow colSpan={5} message="No log entries match these filters." />}
            {logs.map((log) => (
              <tr key={log.id} className="align-top hover:bg-secondary/30">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                  {log.createdAt.toLocaleString('en-GB')}
                </td>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{log.actorName || log.actorId}</p>
                  <p className="text-[11px] text-muted-foreground">{log.actorType}</p>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs font-semibold">{log.action}</span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {log.entity ? (
                    <>
                      <p className="font-medium">{log.entity}</p>
                      {log.entityId && (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {log.entityId.slice(0, 14)}…
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <AuditDetails details={log.details} ipAddress={log.ipAddress} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/audit-logs"
          params={{
            q: params.q,
            action: params.action,
            entity: params.entity,
            from: params.from,
            to: params.to,
          }}
        />
      </TableCard>
    </>
  );
}
