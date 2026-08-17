'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Logo } from '@/components/icons';

export function ConnectClient({
  superAppToken,
  next,
}: {
  superAppToken: string;
  next: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        const response = await fetch('/api/auth/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ superAppToken }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'We could not verify your super-app session.');
        }
        if (cancelled) return;

        router.replace(next);
        router.refresh();
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Connection failed.');
      }
    };

    connect();
    return () => {
      cancelled = true;
    };
  }, [superAppToken, next, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-4">
        <div className="w-full max-w-sm space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Connection error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Try again
            </button>
            <a
              href="/auctions"
              className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-center text-sm font-semibold"
            >
              Browse anyway
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <Logo className="h-14 w-14 text-primary" />
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <div className="text-center">
        <h2 className="text-lg font-semibold">Connecting…</h2>
        <p className="text-sm text-muted-foreground">Establishing your secure GuessLow session.</p>
      </div>
    </div>
  );
}
