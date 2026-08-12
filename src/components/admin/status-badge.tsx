import { Badge } from '@/components/ui/badge';

type Variant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

const MAP: Record<string, { label: string; variant: Variant }> = {
  // Auctions
  DRAFT: { label: 'Draft', variant: 'outline' },
  PENDING_APPROVAL: { label: 'Pending approval', variant: 'warning' },
  SCHEDULED: { label: 'Scheduled', variant: 'secondary' },
  LIVE: { label: 'Live', variant: 'success' },
  ENDED: { label: 'Ended', variant: 'secondary' },
  SETTLED: { label: 'Settled', variant: 'default' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },

  // Bids
  PENDING_PAYMENT: { label: 'Awaiting payment', variant: 'warning' },
  ACTIVE: { label: 'Active', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  VOID: { label: 'Void', variant: 'outline' },
  REFUNDED: { label: 'Refunded', variant: 'secondary' },

  // Payments
  PENDING: { label: 'Pending', variant: 'warning' },
  SUCCESS: { label: 'Success', variant: 'success' },
  EXPIRED: { label: 'Expired', variant: 'outline' },
  REVERSED: { label: 'Reversed', variant: 'destructive' },

  // Winners
  PENDING_CLAIM: { label: 'Awaiting claim', variant: 'warning' },
  CLAIMED: { label: 'Claimed', variant: 'secondary' },
  VERIFIED: { label: 'Verified', variant: 'default' },
  FULFILLED: { label: 'Delivered', variant: 'success' },
  FORFEITED: { label: 'Forfeited', variant: 'destructive' },

  // Approvals
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },

  // Generic
  INACTIVE: { label: 'Inactive', variant: 'outline' },
  SUSPENDED: { label: 'Suspended', variant: 'warning' },
  BLOCKED: { label: 'Blocked', variant: 'destructive' },
  DISABLED: { label: 'Disabled', variant: 'outline' },
  QUEUED: { label: 'Queued', variant: 'secondary' },
  SENT: { label: 'Sent', variant: 'success' },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = MAP[status] ?? { label: status, variant: 'secondary' as Variant };
  return (
    <Badge variant={entry.variant} className={className}>
      {entry.label}
    </Badge>
  );
}
