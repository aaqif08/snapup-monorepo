'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthShell, { AuthAlert, AuthSubmit } from '@/components/AuthShell';
import PasswordField, { MIN_PASSWORD } from '@/components/PasswordField';
import { AccountError, checkResetToken, completePasswordReset } from '@/lib/accountClient';

/**
 * Set a new password from a reset link.
 *
 * ## The token is checked before the form is shown
 *
 * A `GET` validates it without consuming it, so an expired link says so immediately rather
 * than after someone has chosen and typed a new password twice. That check is the whole
 * reason the API has a read-only variant.
 *
 * ## Succeeding does not sign you in
 *
 * Resetting proves control of an inbox, not of the account. Auto-signing-in from a link
 * would mean anyone who reaches that inbox — or that URL in a proxy log — is inside the
 * console with no second step. So this ends on "now sign in", which is one extra action and
 * a materially different threat model.
 */
function ResetForm() {
  const token = useSearchParams().get('token') ?? '';

  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [reason, setReason] = useState<string | null>(null);
  const [emailMasked, setEmailMasked] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      setReason('This page needs a reset link. Request one from the sign-in screen.');
      return;
    }

    void (async () => {
      try {
        const result = await checkResetToken(token);
        if (result.valid) {
          setEmailMasked(result.email_masked);
          setState('ready');
          return;
        }
        setState('invalid');
        setReason(
          result.reason === 'expired'
            ? 'This link has expired. Reset links are valid for one hour.'
            : result.reason === 'already_used'
              ? 'This link has already been used. If that was not you, request another one.'
              : 'This link is not valid. It may have been replaced by a newer one.'
        );
      } catch {
        setState('invalid');
        setReason('Could not check this link. The console may not be able to reach SnapUp.');
      }
    })();
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (confirm !== password) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await completePasswordReset(token, password);
      setState('done');
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'Could not set your password.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'checking') {
    return (
      <AuthShell title="Checking your link" subtitle="One moment.">
        <div className="flex justify-center py-4" role="status" aria-label="Checking">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        </div>
      </AuthShell>
    );
  }

  if (state === 'invalid') {
    return (
      <AuthShell
        title="This link won't work"
        footer={
          <p className="text-center text-xs text-muted">
            <Link
              href="/forgot-password"
              className="font-extrabold text-primary hover:underline"
            >
              Request a new link
            </Link>
            {' · '}
            <Link href="/login" className="font-bold text-muted hover:underline">
              Sign in
            </Link>
          </p>
        }
      >
        <AuthAlert tone="error">{reason}</AuthAlert>
      </AuthShell>
    );
  }

  if (state === 'done') {
    return (
      <AuthShell
        title="Password updated"
        subtitle="Sign in with your new password."
        footer={
          <p className="text-center text-xs text-muted">
            <Link href="/login" className="font-extrabold text-primary hover:underline">
              Go to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-3">
          <AuthAlert tone="success">
            Any other reset links for this account have been cancelled, and the link you just
            used cannot be reused.
          </AuthAlert>
          {/* Said plainly, because being bounced to a login screen after a successful reset
              otherwise reads as a failure. */}
          <p className="text-[11px] leading-relaxed text-muted">
            You are not signed in yet — resetting proves you can read your email, not that
            you are at a trusted device, so the console asks for the password once.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={
        emailMasked ? (
          <>
            For <strong>{emailMasked}</strong>
          </>
        ) : undefined
      }
      footer={
        <p className="text-center text-xs text-muted">
          <Link href="/login" className="font-bold text-muted hover:underline">
            Cancel and sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••••"
          autoComplete="new-password"
          showStrength
          autoFocus
        />

        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••••"
          autoComplete="new-password"
        />

        <p className="text-[11px] leading-relaxed text-muted">
          At least {MIN_PASSWORD} characters. A passphrase of ordinary words is both easier
          to remember and harder to guess than a short jumble.
        </p>

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        <AuthSubmit busy={busy} busyLabel="Saving…">
          Set new password
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
