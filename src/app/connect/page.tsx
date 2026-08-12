import { headers } from 'next/headers';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Logo } from '@/components/icons';
import { ConnectClient } from './client';

export const dynamic = 'force-dynamic';

/**
 * Entry point used by the super app. The webview attaches the customer's
 * Authorization header; we hand it to the client, which exchanges it for a
 * HowLow session cookie and then lands on the requested page.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; token?: string }>;
}) {
  const [headerList, params] = await Promise.all([headers(), searchParams]);
  const authHeader = headerList.get('authorization');

  // Some super-app builds pass the token as a query parameter instead of a
  // header, so accept both.
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader
    : params.token
      ? `Bearer ${params.token}`
      : null;

  // Only same-site paths are accepted as a redirect target.
  const next =
    params.next && params.next.startsWith('/') && !params.next.startsWith('//')
      ? params.next
      : '/';

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <Logo className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 text-xl font-bold">Open HowLow from the super app</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            HowLow uses your super-app account to identify you and to collect bid service fees.
          </p>
          <Alert variant="destructive" className="mt-4 text-left">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Authorization missing</AlertTitle>
            <AlertDescription>
              No super-app token was supplied with this request.
            </AlertDescription>
          </Alert>
          <a
            href="/"
            className="mt-4 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Browse auctions
          </a>
        </div>
      </div>
    );
  }

  return <ConnectClient superAppToken={token} next={next} />;
}
