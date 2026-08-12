'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const COPY: Record<string, { title: string; description: string; confirm: string }> = {
  confirm: {
    title: 'Confirm this payment manually',
    description:
      'Use only when the gateway shows the fee was collected but the callback never arrived. The linked bid becomes ACTIVE and will count toward the auction result.',
    confirm: 'Confirm payment',
  },
  fail: {
    title: 'Mark this payment as failed',
    description:
      'The linked bid is marked failed and will not count toward the auction result.',
    confirm: 'Mark failed',
  },
  reverse: {
    title: 'Reverse / refund this payment',
    description:
      'Records the fee as refunded and removes the linked bid from the auction result and the bidder totals. The actual refund must be processed in the payment system separately.',
    confirm: 'Reverse payment',
  },
};

export function PaymentActions({
  payment,
  canApprove,
}: {
  payment: { id: string; status: string };
  canApprove: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!action) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/payments/${payment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
        return;
      }

      toast({
        title: 'Payment updated',
        description:
          action === 'confirm' && data.bidConfirmed === false
            ? 'Payment confirmed, but the linked bid could not be activated — check the bid status.'
            : undefined,
      });
      setAction(null);
      setNote('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const canConfirm = canApprove && payment.status !== 'SUCCESS' && payment.status !== 'REVERSED';
  const canFail = payment.status === 'PENDING' || payment.status === 'EXPIRED';
  const canReverse = canApprove && payment.status === 'SUCCESS';

  if (!canConfirm && !canFail && !canReverse) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Payment actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canConfirm && (
            <DropdownMenuItem onClick={() => setAction('confirm')}>
              Confirm manually
            </DropdownMenuItem>
          )}
          {canFail && (
            <DropdownMenuItem onClick={() => setAction('fail')}>Mark as failed</DropdownMenuItem>
          )}
          {canReverse && (
            <DropdownMenuItem onClick={() => setAction('reverse')} className="text-destructive">
              Reverse / refund
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={action !== null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? COPY[action].title : ''}</DialogTitle>
            <DialogDescription>{action ? COPY[action].description : ''}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="note">Resolution note</Label>
            <Textarea
              id="note"
              required
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reference the gateway statement or ticket that justifies this."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action === 'confirm' ? 'default' : 'destructive'}
              disabled={busy || !note.trim()}
              onClick={run}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {action ? COPY[action].confirm : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
