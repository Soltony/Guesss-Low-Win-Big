import { AuthPanel, AuthScreen } from '../login/auth-screen';
import { ForgotPasswordForm } from './forgot-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthScreen>
      <AuthPanel>
        <ForgotPasswordForm />
      </AuthPanel>
    </AuthScreen>
  );
}
