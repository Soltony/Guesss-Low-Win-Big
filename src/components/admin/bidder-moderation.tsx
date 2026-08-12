'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { BIDDER_STATUSES } from '@/lib/types';

export function BidderModeration({
  bidderId,
  phone,
  status,
}: {
  bidderId: string;
  phone: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [nextStatus, setNextStatus] = useState(status);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/bidders/${bidderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reason }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Update failed', description: data?.error });
        return;
      }

      toast({ title: `${phone} is now ${nextStatus.toLowerCase()}` });
      setReason('');
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Account moderation
      </h2>

      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {BIDDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Suspended and blocked accounts cannot place new bids. Existing bids are unaffected.
        </p>
      </div>

      {nextStatus !== 'ACTIVE' && (
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <Textarea
            id="reason"
            required
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Recorded in the audit log"
          />
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={saving || nextStatus === status || (nextStatus !== 'ACTIVE' && !reason.trim())}
      >
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Apply
      </Button>
    </form>
  );
}
