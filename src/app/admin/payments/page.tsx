import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { EmptyRow, FilterBar, Pager, TableCard } from '@/components/admin/data-shell';
import { StatusBadge } from '@/components/admin/status-badge';
import { PaymentActions } from '@/components/admin/payment-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { PAYMENT_STATUSES } from '@/lib/types';
import { toNum } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payments' };

const PAGE_SIZE = 25;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = PAYMENT_STATUSES.includes(params.status as any) ? params.status : undefined;
  const q = params.q?.trim();

  const where: any = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { transactionId: { contains: q } },
            { txnRef: { contains: q } },
            { bidder: { phoneNumber: { contains: q } } },
          ],
        }
      : {}),
  };

  const [user, payments, total, statusGroups, successTotal] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        bidder: { select: { id: true, phoneNumber: true } },
        auction: { select: { id: true, code: true } },
        resolvedBy: { select: { fullName: true } },
      },
    }),
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.groupBy({
      by: ['status'],
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: { status: 'SUCCESS' },
      _sum: { amount: true },
    }),
  ]);

  const byStatus = new Map(statusGroups.map((g) => [g.status, g]));
  const canUpdate = hasPermission(user, 'payments', 'update');
  const canApprove = hasPermission(user, 'payments', 'approve');

  return (
    <>
      <PageHeader
        title="Payments"
        description="Bid service fees collected through the super-app wallet."
      />

      <StatGrid>
        <StatCard
          label="Collected"
          value={`${toNum(successTotal._sum.amount).toLocaleString('en-US', {
            maximumFractionDigits: 0,
          })} Br`}
          hint={`${byStatus.get('SUCCESS')?._count._all ?? 0} successful`}
          tone="success"
        />
        <StatCard
          label="Pending"
          value={byStatus.get('PENDING')?._count._all ?? 0}
          hint={`${toNum(byStatus.get('PENDING')?._sum.amount).toFixed(2)} Br in flight`}
          tone="warning"
        />
        <StatCard
          label="Failed"
          value={byStatus.get('FAILED')?._count._all ?? 0}
          tone="destructive"
        />
        <StatCard label="Expired" value={byStatus.get('EXPIRED')?._count._all ?? 0} />
        <StatCard
          label="Reversed"
          value={byStatus.get('REVERSED')?._count._all ?? 0}
          hint={`${toNum(byStatus.get('REVERSED')?._sum.amount).toFixed(2)} Br refunded`}
        />
      </StatGrid>

      <div className="mt-4">
        <FilterBar>
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Transaction id, gateway ref or phone"
            />
          </div>
          <div className="min-w-[160px]">
            <Label htmlFor="status" className="text-xs">
              Status
            </Label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ''}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </FilterBar>
      </div>

      <TableCard>
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Created</th>
              <th className="px-4 py-2.5 font-semibold">Transaction</th>
              <th className="px-4 py-2.5 font-semibold">Bidder</th>
              <th className="px-4 py-2.5 font-semibold">Auction</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Resolution</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.length === 0 && (
              <EmptyRow colSpan={8} message="No payments match these filters." />
            )}
            {payments.map((payment) => (
              <tr key={payment.id} className="align-top hover:bg-secondary/30">
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {payment.createdAt.toLocaleString('en-GB')}
                </td>
                <td className="px-4 py-2.5">
                  <p className="font-mono text-xs">{payment.transactionId.slice(0, 16)}…</p>
                  {payment.txnRef && (
                    <p className="font-mono text-xs text-muted-foreground">
                      ref {payment.txnRef}
                    </p>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/bidders/${payment.bidder.id}`}
                    className="font-mono text-xs hover:text-primary"
                  >
                    {payment.bidder.phoneNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {payment.auction ? (
                    <Link
                      href={`/admin/auctions/${payment.auction.id}`}
                      className="hover:text-primary"
                    >
                      #{payment.auction.code}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {toNum(payment.amount).toFixed(2)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={payment.status} />
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {payment.resolutionNote ? (
                    <>
                      <p className="line-clamp-2">{payment.resolutionNote}</p>
                      {payment.resolvedBy && <p>— {payment.resolvedBy.fullName}</p>}
                    </>
                  ) : payment.failureReason ? (
                    <p className="line-clamp-2 text-destructive">{payment.failureReason}</p>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {canUpdate && (
                    <PaymentActions
                      payment={{ id: payment.id, status: payment.status }}
                      canApprove={canApprove}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          basePath="/admin/payments"
          params={{ status, q }}
        />
      </TableCard>
    </>
  );
}
