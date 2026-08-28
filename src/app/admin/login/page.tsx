import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from './login-form';
import { BrandPanel, ConsoleRibbon } from './brand-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin sign in' };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}) {
  const [user, params] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    searchParams,
  ]);
  if (user) redirect(user.passwordChangeRequired ? '/admin/change-password' : '/admin');

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12 sm:py-16">
      <div className="gl-auth-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
      <ConsoleRibbon />

      <div className="relative w-full max-w-5xl">
        {/* Two halves of one sheet: the brand panel and the form share a single
            rounded frame, and the round submit button sits on the seam. They
            stack under lg, where there is no seam to sit on. */}
        <div className="grid overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_1px_2px_hsl(224_47%_9%/0.06),0_44px_88px_-44px_hsl(224_47%_9%/0.45)] lg:grid-cols-2">
          <BrandPanel />
          <LoginForm
            notice={
              params.passwordChanged ? 'Password updated. Sign in with your new password.' : null
            }
          />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is logged. Unauthorised use is prohibited.
        </p>
      </div>
    </main>
  );
}
