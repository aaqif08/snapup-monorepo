'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ScreenHeader from '@/components/ScreenHeader';
import { AuthError, register, signIn } from '@/lib/authClient';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Customer sign-in and registration.
 *
 * ## Why there is no OTP here any more
 *
 * The pilot specification excludes it. The practical reason is delivery: an SMS in India
 * needs a registered DLT template and a live MSG91 account, and a credential that cannot be
 * delivered is not a credential. A username and a password work on day one.
 *
 * The OTP endpoints remain and the console still uses them for staff. Deleting a working
 * mechanism to satisfy a decision the spec itself calls a pilot choice would only mean
 * building it again afterwards.
 *
 * ## Why one page rather than two
 *
 * Registration is three fields and sign-in is two. Splitting them across routes means a
 * customer who guessed wrong has to go and find the other page — and the guess is common,
 * because most people cannot remember whether they registered on a previous visit.
 * Switching here keeps whatever they have already typed.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);

  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Only ever a path on this origin.
   *
   * The usual way in is a checkout that wants the discount applied, so returning to where
   * they came from matters. An absolute URL would make this page an open redirect, which is
   * a phishing primitive given away for free — and especially cheap to abuse on a screen
   * where someone is already typing a password.
   */
  const requested = params.get('redirect') ?? '/';
  const redirect = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const registering = mode === 'register';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    if (registering && password !== confirmPassword) {
      setError('Both passwords must match.');
      return;
    }

    setBusy(true);
    try {
      const { user } = registering
        ? await register({ username: username.trim(), password, confirmPassword })
        : await signIn(username.trim(), password);

      setUser(user);
      router.replace(redirect);
    } catch (exc) {
      setError(exc instanceof AuthError ? exc.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-lg bg-bg">
      <ScreenHeader title="" onBack={() => router.push('/')} />

      <div className="px-6 pt-2">
        <h1 className="text-2xl font-extrabold text-ink">
          {registering ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {registering
            ? 'You can shop without an account. Sign up to redeem the Snap Up discount and keep your bills.'
            : 'Sign in to redeem your discount and see your past bills.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
          <Field label="Username">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              placeholder="dharsan.k"
              className={inputClass}
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              className={inputClass}
            />
          </Field>

          {registering && (
            <Field label="Re-enter password">
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                className={inputClass}
              />
            </Field>
          )}

          {!registering && (
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-[11px] font-extrabold uppercase tracking-wide text-primary"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? registering
                ? 'Creating your account…'
                : 'Signing in…'
              : registering
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {/* Keeps whatever is already typed. Someone who picked the wrong mode has usually
            typed the right credentials. */}
        <button
          type="button"
          onClick={() => {
            setMode(registering ? 'signin' : 'register');
            setConfirmPassword('');
            setError(null);
          }}
          className="mt-6 w-full text-center text-sm text-muted"
        >
          {registering ? (
            <>
              Already have an account? <span className="font-extrabold text-primary">Sign in</span>
            </>
          ) : (
            <>
              New to Snap Up?{' '}
              <span className="font-extrabold text-primary">Create an account</span>
            </>
          )}
        </button>

        <p className="mt-8 text-center text-[12px] leading-relaxed text-muted">
          You can scan and pay without signing in. An account is only needed to redeem the
          discount and keep your bills. You stay signed in until you log out.
        </p>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-base text-ink outline-none transition focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="min-h-[60vh] bg-bg" />}>
      <LoginForm />
    </Suspense>
  );
}
