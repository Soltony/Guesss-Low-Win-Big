'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type Prompt = 'fulfill' | 'forfeit' | null;

export function WinnerActions({
  winner,
  canPromote,
}: {
  winner: { id: string; status: string; auctionCode: string; phone: string };
  canPromote: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');

  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/winners/${winner.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
        return;
      }

      toast({ title: 'Updated', description: data?.message });
      setPrompt(null);
      setReason('');
      setRef('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const canVerify = winner.status === 'CLAIMED';
  const canFulfill = winner.status === 'CLAIMED' || winner.status === 'VERIFIED';
  const canForfeit = !['FULFILLED', 'FORFEITED', 'CANCELLED'].includes(winner.status);
  const canRemind = winner.status === 'PENDING_CLAIM';
  const canPromoteNow = canPromote && winner.status === 'FORFEITED';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy} aria-label="Winner actions">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRemind && (
            <DropdownMenuItem onClick={() => run('remind')}>Send claim reminder</DropdownMenuItem>
          )}
          {canVerify && (
            <DropdownMenuItem onClick={() => run('verify')}>Verify claim details</DropdownMenuItem>
          )}
          {canFulfill && (
            <DropdownMenuItem onClick={() => setPrompt('fulfill')}>
              Mark as delivered
            </DropdownMenuItem>
          )}
          {canPromoteNow && (
            <DropdownMenuItem onClick={() => run('promote')}>Promote runner-up</DropdownMenuItem>
          )}
          {canForfeit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPrompt('forfeit')}
                className="text-destructive"
              >
                Forfeit prize
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={prompt === 'fulfill'} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark prize as delivered</DialogTitle>
            <DialogDescription>
              Auction #{winner.auctionCode} for {winner.phone}. The winner is notified by SMS.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ref">Delivery reference (optional)</Label>
            <Input
              id="ref"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="Waybill, receipt or handover note"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => run('fulfill', { fulfillmentRef: ref })}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={prompt === 'forfeit'} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forfeit this prize</DialogTitle>
            <DialogDescription>
              The win is revoked and no longer counts for {winner.phone}. Afterwards you can
              promote the next-ranked unique bid as the replacement winner.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Claim window expired, winner unreachable, verification failed…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => run('forfeit', { reason })}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Forfeit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
