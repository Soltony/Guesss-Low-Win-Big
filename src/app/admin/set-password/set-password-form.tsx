'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordChecklist, passwordMeetsRules } from '@/components/admin/password-checklist';
import { cn } from '@/lib/utils';
import { AUTH_BUTTON, AUTH_FIELD, AuthHeading } from '../login/auth-screen';

type Purpose = 'ACTIVATION' | 'PASSWORD_RESET';

interface LinkInfo {
  purpose: Purpose;
  fullName: string;
  email: string;
  expiresAt: string;
}

type Step =
  | { step: 'checking' }
  | { step: 'dead'; message: string }
  | { step: 'form'; info: LinkInfo }
  | { step: 'done'; info: LinkInfo; signedOut: boolean };

const DEAD_LINK = 'This link is invalid, has already been used or has expired.';

/*
 * Every link off this screen is a plain <a>, a full page load, on purpose.
 * The admin layout chooses between these bare screens and the console once per
 * page load, and a client-side <Link> would keep that choice: anyone already
 * signed in who followed one into the console would get it without its sidebar.
 */
const SECONDARY_LINK =
  'block text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline';

/** The token from `#token=…` in the address the email opened. */
function tokenFromFragment(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
}

/**
 * Where every emailed activation and reset link lands. The token is read from
 * the fragment once, taken out of the address bar straight away, and only ever
 * sent to the server in a request body.
 */
export function SetPasswordForm() {
  /** undefined until read; null when the address carried none. */
  const token = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<Step>({ step: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Read exactly once. In development React runs this effect twice, and the
    // second pass would otherwise find the fragment already cleared and call a
    // good link dead.
    if (token.current === undefined) {
      token.current = tokenFromFragment();
      // Out of the address bar and the history entry, so it is not left on
      // screen, in a shared tab, or in a screenshot.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    }

    const value = token.current;
    if (!value) {
      setState({
        step: 'dead',
        message:
          'This address is missing part of the link. Open it again from the email, or copy the whole address into your browser.',
      });
      return;
    }

    let cancelled = false;
    fetch('/api/admin/auth/account-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: value }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        setState(
          response.ok
            ? { step: 'form', info: data as LinkInfo }
            : { step: 'dead', message: data?.error || DEAD_LINK }
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            step: 'dead',
            message: 'The link could not be checked. Check your connection and reload the page.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state.step !== 'form' || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/auth/account-link/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current, password, confirmPassword: confirm }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 404) {
        setState({ step: 'dead', message: data?.error || DEAD_LINK });
        return;
      }
      if (!response.ok) {
        setError({ message: data?.error || 'The password could not be set.', field: data?.field });
        return;
      }

      // Nothing worth keeping in memory once the link is spent.
      token.current = null;
      setPassword('');
      setConfirm('');
      setState({ step: 'done', info: state.info, signedOut: Boolean(data?.signedOut) });
    } catch {
      setError({ message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (state.step === 'checking') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Checking your link…
      </div>
    );
  }

  if (state.step === 'dead') {
    return (
      <div className="space-y-6">
        <AuthHeading icon={ShieldAlert} badge="Account link" title="This link can't be used" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A password reset link can be asked for again below. An invitation to a new account is
          sent again by a system administrator.
        </p>
        <a href="/admin/forgot-password" className={AUTH_BUTTON}>
          Ask for a new reset link
        </a>
        <a href="/admin/login" className={SECONDARY_LINK}>
          Back to sign in
        </a>
      </div>
    );
  }

  const { info } = state;
  const activating = info.purpose === 'ACTIVATION';

  if (state.step === 'done') {
    return (
      <div className="space-y-6">
        <AuthHeading
          icon={CheckCircle2}
          badge={activating ? 'Account activated' : 'Password updated'}
          title={activating ? 'You are all set' : 'Password changed'}
        >
          {activating
            ? `Sign in with ${info.email} and the password you just chose.`
            : 'Your new password works from now on, and every other session has been signed out.'}
        </AuthHeading>
        {activating && state.signedOut && (
          <p className="text-center text-sm text-muted-foreground">
            The account that was signed in on this browser has been signed out, so you can sign in
            as yourself.
          </p>
        )}
        <a href="/admin/login" className={AUTH_BUTTON}>
          Go to sign in
        </a>
      </div>
    );
  }

  const expires = new Date(info.expiresAt);
  const matches = password.length > 0 && password === confirm;

  return (
    <form onSubmit={submit} className="space-y-6">
      <AuthHeading
        icon={KeyRound}
        badge={activating ? 'Activate your account' : 'Reset your password'}
        title={activating ? `Welcome, ${info.fullName.split(/\s+/)[0]}` : 'Choose a new password'}
      >
        {activating ? 'Choose the password you will sign in with. ' : ''}
        You sign in as <strong className="text-foreground">{info.email}</strong>. This link works
        until {expires.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
      </AuthHeading>

      {/* For password managers: the account the new password belongs to. */}
      <input type="email" name="username" autoComplete="username" value={info.email} readOnly hidden />

      {error && !error.field && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-[13px]">
            New password
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              maxLength={128}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              aria-invalid={error?.field === 'password'}
              aria-describedby={error?.field === 'password' ? 'new-password-error' : undefined}
              className={cn(AUTH_FIELD, error?.field === 'password' && 'border-destructive')}
            />
          </div>
          {error?.field === 'password' && (
            <p id="new-password-error" className="text-xs font-medium text-destructive">
              {error.message}
            </p>
          )}
        </div>

        <PasswordChecklist password={password} />

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-[13px]">
            Confirm new password
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                setError(null);
              }}
              className={AUTH_FIELD}
            />
          </div>
          {confirm.length > 0 && !matches && (
            <p className="text-xs font-medium text-destructive">The passwords do not match.</p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !passwordMeetsRules(password) || !matches}
        className={AUTH_BUTTON}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {activating ? 'Activate account' : 'Set new password'}
      </button>
    </form>
  );
}
