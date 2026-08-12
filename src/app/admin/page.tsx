import Link from 'next/link';
import {
  AlertTriangle,
  CheckSquare,
  FlaskConical,
  Gavel,
  ListOrdered,
  Timer,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { StatusBadge } from '@/components/admin/status-badge';
import { TableCard } from '@/components/admin/data-shell';
import { ActivityChart } from '@/components/admin/activity-chart';
import { getDailyActivity, getDashboardMetrics, getTopAuctions } from '@/lib/dashboard-metrics';
import { syncAuctionLifecycle } from '@/lib/auction-engine';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isTestLoginEnabled } from '@/lib/test-login';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function AdminDashboard() {
  await syncAuctionLifecycle();

  const [user, metrics, activity, topAuctions] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    getDashboardMetrics(),
    getDailyActivity(14),
    getTopAuctions(6),
  ]);

  const canSeeMoney = hasPermission(user, 'payments', 'read');
  const alerts = [
    metrics.endedUnsettled > 0 && {
      href: '/admin/auctions?status=ENDED',
      label: `${metrics.endedUnsettled} ended auction(s) awaiting settlement`,
    },
    metrics.pendingApprovals > 0 && {
      href: '/admin/approvals',
      label: `${metrics.pendingApprovals} change(s) waiting for approval`,
    },
    metrics.pendingPayments > 0 && {
      href: '/admin/payments?status=PENDING',
      label: `${metrics.pendingPayments} payment(s) still pending`,
    },
    metrics.pendingClaims > 0 && {
      href: '/admin/winners',
      label: `${metrics.pendingClaims} prize claim(s) to process`,
    },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.fullName?.split(' ')[0] ?? 'operator'}`}
        description="Live view of auctions, bidding activity and settlement workload."
      />

      {isTestLoginEnabled() && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            <strong>Mini-app authorization bypass is enabled.</strong> Anyone who can reach{' '}
            <code>/connect</code> can sign in as any phone number without a super-app token. Their
            bids are marked <code>TEST</code> and charge no fee. Unset{' '}
            <code>ALLOW_TEST_LOGIN</code> before going live.
          </p>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Needs attention
          </p>
          <ul className="mt-2 space-y-1">
            {alerts.map((alert) => (
              <li key={alert.href}>
                <Link
                  href={alert.href}
                  className="text-sm text-foreground underline-offset-2 hover:underline"
                >
                  {alert.label} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <StatGrid>
        <StatCard
          label="Live auctions"
          value={metrics.liveAuctions}
          hint={`${metrics.scheduledAuctions} scheduled`}
          icon={Gavel}
          tone="primary"
        />
        <StatCard
          label="Bids today"
          value={metrics.activeBidsToday}
          hint={`${metrics.activeBidsTotal.toLocaleString()} all time`}
          icon={ListOrdered}
        />
        <StatCard
          label="Bidders"
          value={metrics.bidders.toLocaleString()}
          hint={`+${metrics.newBiddersToday} today`}
          icon={Users}
        />
        <StatCard
          label="Awaiting settlement"
          value={metrics.endedUnsettled}
          hint="Ended, not settled"
          icon={Timer}
          tone={metrics.endedUnsettled > 0 ? 'warning' : 'default'}
        />
        {canSeeMoney && (
          <>
            <StatCard
              label="Fee revenue today"
              value={`${metrics.feeRevenueToday.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} Br`}
              icon={Wallet}
              tone="success"
            />
            <StatCard
              label="Fee revenue total"
              value={`${metrics.feeRevenueTotal.toLocaleString('en-US', {
                maximumFractionDigits: 0,
              })} Br`}
              icon={Wallet}
            />
            <StatCard
              label="Failed payments (30d)"
              value={metrics.failedPayments}
              icon={AlertTriangle}
              tone={metrics.failedPayments > 0 ? 'destructive' : 'default'}
            />
          </>
        )}
        <StatCard
          label="Open approvals"
          value={metrics.pendingApprovals}
          icon={CheckSquare}
          tone={metrics.pendingApprovals > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Prize claims open" value={metrics.pendingClaims} icon={Trophy} />
      </StatGrid>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ActivityChart data={activity} showRevenue={canSeeMoney} />
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Busiest auctions</h2>
            <p className="text-xs text-muted-foreground">By confirmed bid volume</p>
          </div>
          <ul className="divide-y divide-border">
            {topAuctions.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No auctions yet.
              </li>
            )}
            {topAuctions.map((auction) => (
              <li key={auction.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/auctions/${auction.id}`}
                      className="line-clamp-1 text-sm font-medium hover:text-primary"
                    >
                      {auction.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      #{auction.code} · {auction.bidderCount} bidders
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">{auction.bidCount}</p>
                    <StatusBadge status={auction.status} className="mt-0.5" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <TableCard className="mt-6">
        <div className="flex flex-wrap gap-2 p-4">
          {[
            { href: '/admin/auctions/new', label: 'Create auction' },
            { href: '/admin/items/new', label: 'Add item' },
            { href: '/admin/auctions?status=ENDED', label: 'Settle ended auctions' },
            { href: '/admin/winners', label: 'Process claims' },
            { href: '/admin/reports', label: 'Open reports' },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </TableCard>
    </>
  );
}
