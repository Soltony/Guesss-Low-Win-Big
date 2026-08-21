'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2, RefreshCw, Rocket, Star, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface Props {
  auction: {
    id: string;
    code: string;
    status: string;
    featured: boolean;
    bidCount: number;
    reauctionState: string;
    reauctionRound: number;
    maxReauctionRounds: number;
  };
  canUpdate: boolean;
  canSettle: boolean;
  canDelete: boolean;
}

export function AuctionActions({ auction, canUpdate, canSettle, canDelete }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [reauctionOpen, setReauctionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');

  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const response = await fetch(`/api/admin/auctions/${auction.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Action failed', description: data?.error });
        return;
      }

      toast({
        title: data.pending ? 'Sent for approval' : 'Done',
        description:
          data.message ||
          (action === 'reauction'
            ? `Re-auction ${data.code} opened — ${data.bidsCarried} paid bid(s) carried forward for ${data.biddersCarried} bidder(s).`
            : action === 'settle' || action === 'resettle'
              ? data.result?.winnerBidId
                ? `Winner determined at ${data.result.winningAmount?.toFixed(2)}.`
                : data.result?.reauctionCode
                  ? `No valid winner — re-auctioned as ${data.result.reauctionCode}.`
                  : 'Settled — no unique bid, so there is no winner.'
              : undefined),
      });

      setCancelOpen(false);
      setSettleOpen(false);
      setReauctionOpen(false);
      setReason('');
      router.refresh();
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Deleting is separate from the action endpoint above — it is a DELETE on the
   * auction itself, and the row is gone afterwards, so the page it was rendered
   * on has to be left behind rather than refreshed.
   */
  const remove = async () => {
    setBusy('delete');
    try {
      const response = await fetch(`/api/admin/auctions/${auction.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Delete failed', description: data?.error });
        return;
      }

      toast({ title: `Auction #${auction.code} deleted` });
      setDeleteOpen(false);
      router.replace('/admin/auctions');
      router.refresh();
    } catch {
      toast({ variant: 'destructive', title: 'Network error' });
    } finally {
      setBusy(null);
    }
  };

  const canPublish =
    canUpdate && (auction.status === 'DRAFT' || auction.status === 'PENDING_APPROVAL');
  const canCancel =
    canUpdate && !['SETTLED', 'CANCELLED'].includes(auction.status);
  const canSettleNow = canSettle && auction.status === 'ENDED';
  const canResettle = canSettle && auction.status === 'SETTLED';
  // Offered whenever a settled auction has no round behind it yet, including
  // the states the automatic path declined — an operator can override those.
  const canReauction =
    canUpdate && auction.status === 'SETTLED' && auction.reauctionState !== 'CREATED';
  // Whether the server will actually accept the delete. The button is offered
  // to anyone holding the right regardless, so an operator who tries it on an
  // auction that has been public is told why it is refused instead of being
  // left looking for a control that is not there.
  const deletable = auction.status === 'DRAFT' && auction.bidCount === 0;

  if (!canPublish && !canCancel && !canSettleNow && !canResettle && !canUpdate && !canDelete)
    return null;

  return (
    <>
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Actions</h2>

        {canPublish && (
          <Button className="w-full" onClick={() => run('publish')} disabled={busy !== null}>
            {busy === 'publish' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="mr-2 h-4 w-4" />
            )}
            Publish auction
          </Button>
        )}

        {canSettleNow && (
          <Button
            className="w-full"
            variant="default"
            onClick={() => setSettleOpen(true)}
            disabled={busy !== null}
          >
            <Trophy className="mr-2 h-4 w-4" />
            Settle &amp; determine winner
          </Button>
        )}

        {canResettle && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setSettleOpen(true)}
            disabled={busy !== null}
          >
            <Trophy className="mr-2 h-4 w-4" />
            Re-settle auction
          </Button>
        )}

        {canReauction && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setReauctionOpen(true)}
            disabled={busy !== null}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Open re-auction round
          </Button>
        )}

        {canUpdate && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => run('feature', { featured: !auction.featured })}
            disabled={busy !== null}
          >
            <Star className="mr-2 h-4 w-4" />
            {auction.featured ? 'Remove from featured' : 'Mark as featured'}
          </Button>
        )}

        {canCancel && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => setCancelOpen(true)}
            disabled={busy !== null}
          >
            <Ban className="mr-2 h-4 w-4" />
            Cancel auction
          </Button>
        )}

        {canDelete && (
          <Button
            className="w-full text-destructive hover:text-destructive"
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            disabled={busy !== null}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete auction
          </Button>
        )}
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel auction #{auction.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {auction.bidCount > 0
                ? `This auction already has ${auction.bidCount} confirmed bid(s). Cancelling means no winner is determined — the fees already collected will need to be refunded through the payments module.`
                : 'The auction will be closed and removed from the mini-app.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for cancellation (recorded in the audit log)"
            rows={3}
          />

          <AlertDialogFooter>
            <AlertDialogCancel>Keep auction</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || busy !== null}
              onClick={(event) => {
                event.preventDefault();
                run('cancel', { reason });
              }}
            >
              {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel auction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete auction #{auction.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletable
                ? 'This draft has never been public and has no bids, so it can be removed for good. This cannot be undone.'
                : `Only a draft auction with no bids can be deleted. This one is ${auction.status.toLowerCase().replace(/_/g, ' ')}${
                    auction.bidCount > 0 ? ` and already has ${auction.bidCount} confirmed bid(s)` : ''
                  } — cancel it instead, so its bid and payment history survives.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Keep auction</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
            >
              {busy === 'delete' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete auction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reauctionOpen} onOpenChange={setReauctionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open a re-auction of #{auction.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              A new round is created with the same item and the same rules, as round{' '}
              {auction.reauctionRound + 1} of at most {auction.maxReauctionRounds}. Every bid a
              bidder already paid for in this chain carries into it free of charge — they are only
              charged once they bid beyond what they have paid for. Everyone from the previous
              round is notified.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (recorded in the audit log and on the auction)"
            rows={3}
          />

          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                run('reauction', { reason });
              }}
            >
              {busy === 'reauction' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Open re-auction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={settleOpen} onOpenChange={setSettleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canResettle ? 'Re-settle' : 'Settle'} auction #{auction.code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every confirmed bid is grouped by amount. Amounts held by exactly one bidder are
              unique; the lowest of those wins. Bid statuses become visible to bidders once this
              runs.
              {canResettle &&
                ' Re-settling discards the existing result and winner record, then recomputes from scratch.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                run(canResettle ? 'resettle' : 'settle');
              }}
            >
              {(busy === 'settle' || busy === 'resettle') && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {canResettle ? 'Re-settle' : 'Settle now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
