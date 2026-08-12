'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Authorization bypass, shown only when ALLOW_TEST_LOGIN=true.
 * Signs a tester in as any phone number so the bidding flow can be exercised
 * without the super app.
 */
export function TestLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/test-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, fullName: name }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error || 'Could not start the test session.');
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-accent/40 bg-accent/5 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4 text-accent" />
        Test sign-in
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Bypasses super-app authorization. Bids placed in a test session are marked
        <strong> TEST</strong> and never charge a fee.
      </p>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3 space-y-2">
        <div className="space-y-1">
          <Label htmlFor="test-phone" className="text-xs">
            Phone number
          </Label>
          <Input
            id="test-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0911223344 — leave blank for a random tester"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="test-name" className="text-xs">
            Display name (optional)
          </Label>
          <Input
            id="test-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="QA tester"
            autoComplete="off"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Continue as test bidder
      </button>
    </form>
  );
}
