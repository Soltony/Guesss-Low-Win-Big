'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, CheckSquare, Loader2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { EmptyState } from '@/components/miniapp/section-heading';
import { useToast } from '@/hooks/use-toast';
import { PENDING_CHANGE_STATUSES } from '@/lib/types';

export interface ChangeRow {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string | null;
  status: string;
  comment: string | null;
  payload: string;
  previousData: string | null;
  changedFields: string | null;
  createdBy: string;
  createdById: string;
  approvedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

function safeParse(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  const asString = String(value);
  // ISO timestamps read badly in a diff table.
  if (/^\d{4}-\d{2}-\d{2}T/.test(asString)) return new Date(asString).toLocaleString('en-GB');
  return asString;
}

function entityHref(change: ChangeRow) {
  if (!change.entityId) return null;
  switch (change.entityType) {
    case 'Auction':
      return `/admin/auctions/${change.entityId}`;
    case 'Item':
      return `/admin/items/${change.entityId}`;
    case 'Category':
      return '/admin/categories';
    case 'Banner':
      return '/admin/content';
    case 'SystemSetting':
      return '/admin/settings';
    default:
      return null;
  }
}

function Diff({ change }: { change: ChangeRow }) {
  const payload = safeParse(change.payload) ?? {};
  const previous = safeParse(change.previousData);
  const fields: string[] = safeParse(change.changedFields) ?? Object.keys(payload);

  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">No field-level changes recorded.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 font-medium">Field</th>
          <th className="py-1 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {fields.map((field) => (
          <tr key={field}>
            <td className="py-1.5 pr-2 font-medium">{field}</td>
            <td className="py-1.5 pr-2 text-muted-foreground line-through decoration-destructive/40">
              {formatValue(previous?.[field])}
            </td>
            <td className="py-1.5 font-semibold text-primary">{formatValue(payload[field])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApprovalsList({
  changes,
  currentUserId,
  canApprove,
  activeStatus,
}: {
  changes: ChangeRow[];
  currentUserId: string;
  canApprove: boolean;
  activeStatus: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ change: ChangeRow; decision: string } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async () => {
    if (!dialog) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/approvals/${dialog.change.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: dialog.decision, comment }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Decision failed', description: data?.error });
        return;
      }

      toast({ title: data?.message || 'Decision recorded' });
      setDialog(null);
      setComment('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const switchStatus = (status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', status);
    router.push(`/admin/approvals?${params.toString()}`);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {PENDING_CHANGE_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchStatus(value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
              activeStatus === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card'
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {changes.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="Nothing here"
          description={
            activeStatus === 'PENDING'
              ? 'No changes are waiting for approval.'
              : `No ${activeStatus.toLowerCase()} requests.`
          }
        />
      ) : (
        <ul className="space-y-3">
          {changes.map((change) => {
            const isOwn = change.createdById === currentUserId;
            const href = entityHref(change);
            const canDecide = canApprove && change.status === 'PENDING' && !isOwn;
            const canWithdraw = change.status === 'PENDING' && isOwn;

            return (
              <li key={change.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-bold uppercase">
                        {change.action}
                      </span>
                      <span className="text-sm font-semibold">{change.entityType}</span>
                      <StatusBadge status={change.status} />
                    </div>
                    <p className="mt-1.5 font-medium">
                      {change.summary || `${change.action} ${change.entityType}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Requested by {change.createdBy} ·{' '}
                      {new Date(change.createdAt).toLocaleString('en-GB')}
                      {change.approvedBy &&
                        ` · decided by ${change.approvedBy} ${
                          change.decidedAt
                            ? new Date(change.decidedAt).toLocaleString('en-GB')
                            : ''
                        }`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {href && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={href}>Open record</Link>
                      </Button>
                    )}
                    {canWithdraw && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ change, decision: 'CANCELLED' })}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        Withdraw
                      </Button>
                    )}
                    {canDecide && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDialog({ change, decision: 'REJECTED' })}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setDialog({ change, decision: 'APPROVED' })}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          Approve
                        </Button>
                      </>
                    )}
                    {change.status === 'PENDING' && isOwn && canApprove && (
                      <span className="text-xs text-muted-foreground">
                        You raised this request
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto rounded-lg bg-secondary/40 p-3">
                  <Diff change={change} />
                </div>

                {change.comment && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <strong>Comment:</strong> {change.comment}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.decision === 'APPROVED'
                ? 'Approve and apply this change'
                : dialog?.decision === 'REJECTED'
                  ? 'Reject this change'
                  : 'Withdraw this request'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.decision === 'APPROVED'
                ? 'Approving applies the change immediately. This is recorded against your account.'
                : dialog?.decision === 'REJECTED'
                  ? 'The change is discarded and the requester keeps the original record.'
                  : 'Your own request is cancelled without being applied.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="comment">
              Comment{dialog?.decision === 'REJECTED' ? '' : ' (optional)'}
            </Label>
            <Textarea
              id="comment"
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.decision === 'APPROVED' ? 'default' : 'destructive'}
              disabled={busy || (dialog?.decision === 'REJECTED' && !comment.trim())}
              onClick={decide}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
