import { AuthPanel, AuthScreen } from '../login/auth-screen';
import { SetPasswordForm } from './set-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose your password' };

/** Where activation and password reset emails link to. See src/lib/account-links.ts. */
export default function SetPasswordPage() {
  return (
    <AuthScreen>
      <AuthPanel>
        <SetPasswordForm />
      </AuthPanel>
    </AuthScreen>
  );
}
