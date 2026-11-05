import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from './login-form';
import { AuthScreen } from './auth-screen';

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
    <AuthScreen>
      <LoginForm
        notice={params.passwordChanged ? 'Password updated. Sign in with your new password.' : null}
      />
    </AuthScreen>
  );
}
