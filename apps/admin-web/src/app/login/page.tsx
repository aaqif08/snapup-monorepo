'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell, { AuthAlert, AuthField, AuthSubmit, authInputClass } from '@/components/AuthShell';
import PasswordField from '@/components/PasswordField';
import { AccountError, fetchMe, login } from '@/lib/accountClient';
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
export default function ConsoleLoginPage() {
  const router = useRouter();
  const setUser = useAdminAuthStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durable, setDurable] = useState<boolean | null>(null);

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
  }, [router, setUser]);

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
    </AuthShell>
  );
}
