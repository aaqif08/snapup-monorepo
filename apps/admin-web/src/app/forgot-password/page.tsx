'use client';

import Link from 'next/link';
import { useState } from 'react';
import AuthShell, { AuthAlert, AuthField, AuthSubmit, authInputClass } from '@/components/AuthShell';
import { AccountError, requestPasswordReset, type ForgotResult } from '@/lib/accountClient';

/**
 * Request a password-reset link.
 *
 * ## The confirmation is worded carefully
 *
 * The API answers identically whether or not an account exists, so that it cannot be used
 * to discover who works here. This page must not then undo that by saying "we've sent you
 * a link" — that sentence *is* the confirmation the API refused to give. It says "if that
 * address has an account" instead, which is both true and unhelpful to someone fishing.
 *
 * ## Only console accounts have passwords
 *
 * Customers sign in with a phone and a one-time code, so there is nothing here for them.
 * Said explicitly, because a shopper who lands on this page from a search result should be
 * told where to go rather than left typing an address that will never match.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<ForgotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      setSent(await requestPasswordReset(email.trim()));
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'Could not send a reset link.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    const minutes = Math.round(sent.expires_in_seconds / 60);
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            If <strong>{sent.email_masked}</strong> has a console account, a reset link is on
            its way.
          </>
        }
        footer={
          <div className="space-y-2 text-center text-xs text-muted">
            <p>
              <Link href="/login" className="font-extrabold text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
            <button
              type="button"
              onClick={() => setSent(null)}
              className="font-bold text-muted hover:text-ink hover:underline"
            >
              Use a different address
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <AuthAlert tone="success">
            The link is valid for {minutes} minutes and can be used once. Requesting another
            one replaces it.
          </AuthAlert>
          <p className="text-[11px] leading-relaxed text-muted">
            Nothing arrived? Check spam, then confirm you used your work address. We
            deliberately do not say whether an account exists for a given address — so an
            empty inbox may simply mean there is no account here.
          </p>
          <p className="text-[11px] leading-relaxed text-muted">
            <strong>No mail provider is configured in this environment</strong>, so the link
            is written to the customer app&apos;s server log instead. Look for a{' '}
            <code className="font-mono">[reset]</code> line.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <div className="space-y-2 text-center text-xs text-muted">
          <p>
            <Link href="/login" className="font-extrabold text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
          <p className="leading-relaxed">
            Shopping with SnapUp? The customer app signs you in with your mobile number and a
            code — there is no password to reset.
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <AuthField label="Work email" error={fieldError}>
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

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        <AuthSubmit busy={busy} busyLabel="Sending…">
          Send reset link
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
