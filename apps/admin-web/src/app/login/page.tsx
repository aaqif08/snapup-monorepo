'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import AuthShell, { AuthAlert, AuthField, AuthSubmit, authInputClass } from '@/components/AuthShell';
import PasswordField from '@/components/PasswordField';
import {
  AccountError,
  fetchAuthConfig,
  fetchMe,
  login,
  requestConsoleOtp,
  verifyConsoleOtp,
} from '@/lib/accountClient';
import GoogleButton from '@/components/GoogleButton';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

/**
 * Console sign-in.
 *
 * Sign-up moved to its own page: it has five fields and a rule that needs explaining, and
 * neither fits in a tab on a card sized for two inputs.
 *
 * What this replaced accepted **any** email with **any** six-character password and gave
 * itself the `manager` role, entirely in the browser. The store registry — including every
 * branch's authorised network ranges — was editable by anyone who could type an `@`.
 */
/** Redirect reasons the Google round trip can come back with. */
const GOOGLE_ERRORS: Record<string, string> = {
  google_no_account:
    'No console account uses that Google address. Create an account first, then Google will sign you in.',
  google_state: 'That sign-in attempt expired. Please try again.',
  google_not_configured: 'Google sign-in is not enabled on this deployment.',
  google_failed: 'Google could not confirm that sign-in. Please try again.',
};

export default function ConsoleLoginPage() {
  const router = useRouter();
  const setUser = useAdminAuthStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durable, setDurable] = useState<boolean | null>(null);

  /** Which credential the person is using. Password stays the default: it is the one
   *  every console account definitely has, since a phone is optional at signup. */
  const [method, setMethod] = useState<'password' | 'phone'>('password');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const me = await fetchMe();
        setDurable(me.accounts_durable);
        if (me.user && me.user.role !== 'customer') {
          setUser(me.user);
          router.replace('/');
        }
      } catch {
        setDurable(null);
      }
    })();
    void fetchAuthConfig().then((config) => setGoogleEnabled(config.google));
  }, [router, setUser]);

  // The Google round trip cannot show its own error — it is a browser redirect — so it
  // reports back through the query string and this turns the code into a sentence.
  const params = useSearchParams();
  useEffect(() => {
    const reason = params.get('auth_error');
    if (!reason) return;
    if (reason === 'google_cancelled') return; // They chose to stop. Not an error.
    if (reason === 'account_pending') {
      setPendingApproval(true);
      return;
    }
    setError(GOOGLE_ERRORS[reason] ?? 'That sign-in did not complete. Please try again.');
  }, [params]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPendingApproval(false);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    try {
      const { user } = await login(email.trim(), password);
      setUser(user);
      router.replace('/');
    } catch (exc) {
      // Pending approval gets its own treatment. It is the one failure where the useful
      // action is "go and ask a colleague" rather than "try again", and leaving it inside
      // the generic message means people retype a correct password until they give up.
      if (exc instanceof AccountError && exc.code === 'pending_approval') {
        setPendingApproval(true);
      } else {
        setError(exc instanceof AccountError ? exc.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setError(null);
    setPendingApproval(false);

    if (!phone.trim()) {
      setError('Enter the mobile number on your console account.');
      return;
    }

    setBusy(true);
    try {
      await requestConsoleOtp(phone.trim());
      setOtpSent(true);
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'Could not send a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    setBusy(true);
    try {
      const { user } = await verifyConsoleOtp(phone.trim(), otp.trim());
      setUser(user);
      router.replace('/');
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="SnapUp Business"
      subtitle="Sign in to manage products, staff, stores and analytics."
      footer={
        <p className="text-center text-xs leading-relaxed text-muted">
          New here?{' '}
          <Link href="/signup" className="font-extrabold text-primary hover:underline">
            Create an account
          </Link>
          <br />
          <span className="text-[11px]">
            Separate from the SnapUp customer app. You stay signed in until you log out.
          </span>
        </p>
      }
    >
      {googleEnabled && (
        <>
          <GoogleButton label="Continue with Google" />
          <div className="flex items-center gap-3 py-4">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {/* Two credentials, one account. Switching resets the code step so a half-finished
          phone attempt cannot be submitted against a number that has since been edited. */}
      <div className="mb-5 flex rounded-xl border border-border bg-bg p-1">
        {(['password', 'phone'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMethod(option);
              setOtpSent(false);
              setOtp('');
              setError(null);
            }}
            className={`flex-1 rounded-lg py-2 text-xs font-extrabold transition ${
              method === option ? 'bg-surface text-ink shadow-sm' : 'text-muted'
            }`}
          >
            {option === 'password' ? 'Email & password' : 'Mobile number'}
          </button>
        ))}
      </div>

      {method === 'phone' ? (
        <form onSubmit={submitCode} className="space-y-4" noValidate>
          <AuthField label="Mobile number">
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              inputMode="tel"
              disabled={otpSent}
              className={authInputClass}
            />
          </AuthField>

          {otpSent && (
            <AuthField label="Six-digit code">
              <input
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className={`${authInputClass} text-center font-mono text-lg tracking-[0.4em]`}
              />
            </AuthField>
          )}

          {error && <AuthAlert tone="error">{error}</AuthAlert>}

          {pendingApproval && (
            <AuthAlert tone="warning">
              Your account is waiting for an owner to approve it. There is nothing to retry.
            </AuthAlert>
          )}

          {otpSent ? (
            <>
              <AuthSubmit busy={busy} busyLabel="Checking…">
                Sign in
              </AuthSubmit>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtp('');
                }}
                className="w-full text-center text-[11px] font-extrabold uppercase tracking-wide text-muted hover:underline"
              >
                Use a different number
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy}
              className="w-full rounded-xl bg-primary py-3.5 text-sm font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          )}
        </form>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <AuthField label="Work email">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@kurinji.in"
            autoComplete="email"
            autoFocus
            className={authInputClass}
          />
        </AuthField>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••••"
          autoComplete="current-password"
        />

        {/* Beneath the field it relates to, where someone who has just failed to sign in is
            already looking. */}
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-[11px] font-extrabold uppercase tracking-wide text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        {pendingApproval && (
          <AuthAlert tone="warning">
            Your account is waiting for an owner to approve it. Ask whoever set up this
            console to activate you in <strong>Staff management</strong> — your password is
            fine, there is nothing to retry.
          </AuthAlert>
        )}

        {durable === false && (
          <AuthAlert tone="warning">
            <strong>No database configured.</strong> Accounts are kept in memory and are lost
            on restart. Run <code className="font-mono">npm run db:migrate</code> and restart
            to make them durable.
          </AuthAlert>
        )}

        <AuthSubmit busy={busy} busyLabel="Signing in…">
          Sign in
        </AuthSubmit>
      </form>
      )}
    </AuthShell>
  );
}
