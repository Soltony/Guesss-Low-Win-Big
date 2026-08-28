'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Filled fields rather than outlined ones: the panel is already a plain white
 * surface, so the input's own tint is what tells you where to type.
 */
const FIELD =
  'h-12 rounded-xl border-transparent bg-secondary pl-11 text-[15px] transition-colors focus-visible:bg-card focus-visible:border-primary/40';

export function LoginForm({ notice }: { notice?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error || 'Sign in failed.');
        return;
      }

      router.replace(data.redirectTo || '/admin');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Positioned: the round button below hangs off this panel's left edge,
    // which is the seam between the two halves of the card.
    <div className="relative flex flex-col justify-center bg-card px-7 py-10 sm:px-11 lg:px-14 lg:py-12">
      <form onSubmit={submit} className="mx-auto w-full max-w-[22rem]">
        {/* The seam button and the full-width one below are the same control.
            Only one of them should reach assistive tech, and the labelled one
            in the flow of the form is the better of the two.

            It sits on the join between the two halves of the card, which is
            where the eye lands first — so it is the one thing here that moves
            on its own. All of it stops while the request is in flight; the
            spinner is the signal then, and competing motion only muddies it. */}
        <button
          type="submit"
          disabled={loading}
          tabIndex={-1}
          aria-hidden="true"
          className="group absolute left-0 top-1/2 hidden h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full lg:flex"
        >
          {/* A dot doing a slow lap just outside the white ring. */}
          {!loading && (
            <span
              className="gl-spin-slow pointer-events-none absolute -inset-[18px] rounded-full"
              style={{ animationDuration: '11s' }}
            >
              <span className="absolute left-1/2 top-0 h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]" />
            </span>
          )}

          {/* The gold face is its own layer so the halo below can be stacked
              over it — the rings have to cross the white ring, not disappear
              behind it. */}
          <span className="gl-gold relative flex h-full w-full items-center justify-center rounded-full ring-[10px] ring-card">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ArrowRight
                className="h-6 w-6 transition-transform duration-200 group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            )}
          </span>

          {/* Last child, so both rings paint above the face and the ring alike.
              As ::before and ::after of one element they stay half a cycle
              apart for free. */}
          {!loading && (
            <span className="gl-halo pointer-events-none absolute inset-0 rounded-full" />
          )}
        </button>

        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure sign-in
          </span>
          <h1 className="mt-4 text-[28px] font-extrabold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in to your account to continue
          </p>
        </div>

        <div className="mt-7 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!error && notice && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{notice}</AlertDescription>
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
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@guesslow.et"
                className={FIELD}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[13px]">
              Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className={`${FIELD} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="gl-gold mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Signing in' : 'Sign in'}
        </button>

        <p className="mt-6 border-t border-border pt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Locked out or need an account? Contact a system administrator.
        </p>
      </form>
    </div>
  );
}
