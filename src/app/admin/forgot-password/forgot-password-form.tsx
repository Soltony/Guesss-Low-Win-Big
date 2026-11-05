'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, Mail, MailCheck, MailQuestion } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AUTH_BUTTON, AUTH_FIELD, AuthHeading } from '../login/auth-screen';

const SECONDARY_LINK =
  'block text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline';

// The way back to sign-in is a plain <a>, a full page load: someone already
// signed in is sent on to the console from there, and only a full load gives
// the console its shell. See the note in src/app/admin/layout.tsx.

/**
 * Asks for a password reset link. The answer reads the same for every address
 * — the server never says whether one belongs to an account — so this screen
 * cannot say so either.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError({ message: data?.error || 'The request could not be sent.', field: data?.field });
        return;
      }
      setSentTo(email.trim());
    } catch {
      setError({ message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <div className="space-y-6">
        <AuthHeading icon={MailCheck} badge="Password reset" title="Check your email">
          If an account that can sign in uses <strong className="text-foreground">{sentTo}</strong>,
          a link to choose a new password is on its way. It works once, and only for a short time.
        </AuthHeading>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing after a few minutes? Check your spam folder. An account still waiting on its
          invitation, or one an administrator has reset, gets its link from a system administrator.
        </p>
        <a href="/admin/login" className={AUTH_BUTTON}>
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <AuthHeading icon={MailQuestion} badge="Password reset" title="Forgot your password?">
        Enter the email address you sign in with, and we will send a link to choose a new one.
      </AuthHeading>

      {error && !error.field && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-[13px]">
          Email
        </Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            placeholder="you@guesslow.et"
            aria-invalid={error?.field === 'email'}
            aria-describedby={error?.field === 'email' ? 'email-error' : undefined}
            className={cn(AUTH_FIELD, error?.field === 'email' && 'border-destructive')}
          />
        </div>
        {error?.field === 'email' && (
          <p id="email-error" className="text-xs font-medium text-destructive">
            {error.message}
          </p>
        )}
      </div>

      <button type="submit" disabled={submitting || !email.trim()} className={AUTH_BUTTON}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Send reset link
      </button>
      <a href="/admin/login" className={SECONDARY_LINK}>
        Back to sign in
      </a>
    </form>
  );
}
