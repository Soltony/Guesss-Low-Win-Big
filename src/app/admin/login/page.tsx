import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from './login-form';
import { LogoWordmark } from '@/components/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin sign in' };

export default async function AdminLoginPage() {
  const user = await getCurrentUser({ allowRefresh: false });
  if (user) redirect(user.passwordChangeRequired ? '/admin/change-password' : '/admin');

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <LogoWordmark className="justify-center text-2xl text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Auction operations console</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is logged. Unauthorised use is prohibited.
        </p>
      </div>
    </div>
  );
}
