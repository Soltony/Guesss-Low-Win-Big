import { headers } from 'next/headers';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Logo } from '@/components/icons';
import { ConnectClient } from './client';
import { TestLoginForm } from './test-login-form';
import { isTestLoginEnabled } from '@/lib/test-login';

export const dynamic = 'force-dynamic';

/**
 * Entry point used by the super app. The webview attaches the customer's
 * Authorization header; we hand it to the client, which exchanges it for a
 * GuessLow session cookie and then lands on the requested page.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; token?: string; test?: string }>;
}) {
  const [headerList, params] = await Promise.all([headers(), searchParams]);
  const authHeader = headerList.get('authorization');

  // Some super-app builds cannot set headers on a webview navigation, so a
  // query parameter is accepted too.
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

  const testEnabled = isTestLoginEnabled();

  // `?test=1` forces the bypass screen even when a token is present, so QA can
  // switch to a test identity without clearing the webview.
  if (token && params.test !== '1') {
    return <ConnectClient superAppToken={token} next={next} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="mx-auto h-12 w-12 text-foreground" />
          <h1 className="mt-3 text-lg font-semibold tracking-tight">
            Open GuessLow from the super app
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            GuessLow uses your super-app account to identify you and to collect bid service fees.
          </p>
        </div>

        {!token && (
          <Alert variant="destructive" className="mb-4 text-left">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Authorization missing</AlertTitle>
            <AlertDescription>
              No super-app token was supplied with this request.
            </AlertDescription>
          </Alert>
        )}

        {testEnabled && <TestLoginForm next={next} />}

        <Link
          href="/"
          className="mt-3 block rounded-md border border-border bg-card px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-secondary"
        >
          Browse auctions without signing in
        </Link>

        {!testEnabled && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
            Testing without the super app? Set <code>ALLOW_TEST_LOGIN=true</code> in the
            environment to enable the bypass sign-in on this screen.
          </p>
        )}
      </div>
    </div>
  );
}
