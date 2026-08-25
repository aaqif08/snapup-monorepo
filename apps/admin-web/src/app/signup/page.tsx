'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell, { AuthAlert, AuthField, AuthSubmit, authInputClass } from '@/components/AuthShell';
import PasswordField, { MIN_PASSWORD } from '@/components/PasswordField';
import { AccountError, fetchMe, signup } from '@/lib/accountClient';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

/**
 * Console sign-up, on its own page.
 *
 * It was a tab on the sign-in card, which was wrong for the reason any two-mode form is
 * wrong: sign-up here has five fields and a consequence that needs explaining (the first
 * account becomes the owner; every later one waits for approval), and none of that fits in
 * a panel sized for two inputs.
 */
export default function ConsoleSignupPage() {
  const router = useRouter();
  const setUser = useAdminAuthStore((state) => state.setUser);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durable, setDurable] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = await fetchMe();
        setDurable(me.accounts_durable);
        // Already signed in — nothing on this page applies.
        if (me.user && me.user.role !== 'customer') {
          setUser(me.user);
          router.replace('/');
        }
      } catch {
        setDurable(null);
      }
    })();
  }, [router, setUser]);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid work email address.';
    }
    if (password.length < MIN_PASSWORD) {
      errors.password = `At least ${MIN_PASSWORD} characters.`;
    }
    // Checked client-side only — the server has no use for it. Its whole purpose is
    // catching a typo in something the person cannot see while typing.
    if (confirm !== password) {
      errors.confirm = 'The two passwords do not match.';
    }
    if (phone.trim() && phone.replace(/\D/g, '').length < 10) {
      errors.phone = 'Enter a 10-digit mobile number, or leave it blank.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const result = await signup({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      });

      if (result.pending_approval) {
        setPending(true);
        return;
      }

      // Bootstrap owner — the server has already signed them in.
      setUser(result.user);
      router.replace('/');
    } catch (exc) {
      if (exc instanceof AccountError && exc.code === 'email_taken') {
        setFieldErrors({ email: 'An account already exists for this email.' });
      } else if (exc instanceof AccountError && exc.code === 'phone_taken') {
        setFieldErrors({ phone: 'That mobile number is already attached to an account.' });
      } else {
        setError(exc instanceof AccountError ? exc.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <AuthShell
        title="Account created"
        subtitle="One more step, and it is not yours to take."
        footer={
          <p className="text-center text-xs text-muted">
            <Link href="/login" className="font-extrabold text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        }
      >
        <AuthAlert tone="warning">
          An owner has to activate <strong>{email.trim()}</strong> in Staff management before
          you can sign in. Ask whoever set up this console — they will see you at the top of
          that screen, marked as waiting for approval.
        </AuthAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="SnapUp Business — the console for products, staff, stores and analytics."
      width="md"
      footer={
        <p className="text-center text-xs text-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-extrabold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <AuthField label="Your name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="R. Dharsan"
            autoComplete="name"
            autoFocus
            className={authInputClass}
          />
        </AuthField>

        <AuthField label="Work email" error={fieldErrors.email}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@kurinji.in"
            autoComplete="email"
            className={authInputClass}
          />
        </AuthField>

        <AuthField label="Mobile number (optional)" error={fieldErrors.phone}>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="98765 43210"
            autoComplete="tel"
            className={authInputClass}
          />
        </AuthField>
        <p className="-mt-2 text-[11px] leading-relaxed text-muted">
          Adding it lets you sign in to the <strong>customer app</strong> with the same
          account — useful for testing the shopper experience on the floor.
        </p>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••••"
          autoComplete="new-password"
          showStrength
        />
        {fieldErrors.password && (
          <p className="-mt-2 text-[11px] font-bold text-danger">{fieldErrors.password}</p>
        )}

        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••••"
          autoComplete="new-password"
        />
        {fieldErrors.confirm && (
          <p className="-mt-2 text-[11px] font-bold text-danger">{fieldErrors.confirm}</p>
        )}

        <p className="text-[11px] leading-relaxed text-muted">
          Length is what makes a password hard to guess, so there are no symbol
          requirements — a passphrase of ordinary words beats {MIN_PASSWORD} random
          characters. Stored hashed with scrypt; we never see or keep the original.
        </p>

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        {/* The rule that surprises people, said before they submit rather than after. */}
        <AuthAlert tone="success">
          The <strong>first</strong> account on this install becomes the owner and can manage
          everyone else. Any account after that needs an owner to approve it.
        </AuthAlert>

        {durable === false && (
          <AuthAlert tone="warning">
            <strong>No database configured.</strong> Accounts are kept in memory and will be
            lost on restart. Run <code className="font-mono">npm run db:migrate</code> first.
          </AuthAlert>
        )}

        <AuthSubmit busy={busy} busyLabel="Creating account…">
          Create account
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
