'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

  /**
   * Registering a shop is opt-in.
   *
   * A colleague joining an existing branch has no shop of their own to describe, and
   * making them scroll past eight fields that do not apply is how a signup form gets
   * abandoned. Owners tick the box; staff do not.
   */
  const [registerStore, setRegisterStore] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [ssid, setSsid] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('21:00');
  const [storeRegistered, setStoreRegistered] = useState<string | null>(null);

  /**
   * Google sends people here when their address has no console account.
   *
   * There is deliberately no "sign up with Google" button: signing up decides a role,
   * an approval state and possibly a whole shop, none of which follows from owning a
   * Google account. So Google signs you *in* to an account made here, and this explains
   * that to someone who has just been bounced.
   */
  const params = useSearchParams();
  const fromGoogle = params.get('auth_error') === 'google_no_account';
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
        store: registerStore
          ? {
              name: storeName.trim(),
              address: address.trim(),
              advertisedSsid: ssid.trim(),
              // Sent as numbers or omitted entirely. An empty string would be coerced to
              // zero somewhere downstream, and zero is a real coordinate in the Gulf of
              // Guinea rather than a missing one.
              ...(latitude.trim() ? { latitude: Number(latitude) } : {}),
              ...(longitude.trim() ? { longitude: Number(longitude) } : {}),
              opensAt,
              closesAt,
              // Deliberately not sent: the server registers every self-signed-up shop
              // inactive regardless, and a field the client could set would be a field the
              // client could set to true.
            }
          : undefined,
      });

      if (result.store) setStoreRegistered(result.store.name);

      if (result.pending_approval) {
        setPending(true);
        return;
      }

      // Bootstrap owner — the server has already signed them in.
      setUser(result.user);
      router.replace('/');
    } catch (exc) {
      if (exc instanceof AccountError && exc.code === 'invalid_store') {
        setError(exc.message);
      } else if (exc instanceof AccountError && exc.code === 'email_taken') {
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

        {storeRegistered && (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <p className="text-sm font-extrabold text-ink">{storeRegistered} is registered</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              It is saved with your Wi-Fi network, location and opening hours, and is hidden
              from customers until an owner activates it in <strong>Stores</strong>. Nothing
              is lost in the meantime.
            </p>
          </div>
        )}
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
      {fromGoogle && (
        <div className="mb-5">
          <AuthAlert tone="warning">
            That Google account is not registered here yet. Create an account with the same
            email address and you will be able to use the Google button to sign in from
            then on.
          </AuthAlert>
        </div>
      )}

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

        {/* ---- The shop ---- */}
        <div className="rounded-2xl border border-border bg-bg p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={registerStore}
              onChange={(event) => setRegisterStore(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]"
            />
            <span>
              <span className="block text-sm font-extrabold text-ink">
                I am registering my shop
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                Tick this if you own the shop. Leave it if you are joining a branch that is
                already on SnapUp.
              </span>
            </span>
          </label>

          {registerStore && (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <AuthField label="Shop name">
                <input
                  value={storeName}
                  onChange={(event) => setStoreName(event.target.value)}
                  placeholder="Kurinji Metro Bazaar — Trichy"
                  className={authInputClass}
                />
              </AuthField>

              <AuthField label="Address">
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="60/4 A1C Singaram Nagar, Kattur, Tiruchirappalli"
                  className={authInputClass}
                />
              </AuthField>

              <AuthField label="Customer Wi-Fi network name (SSID)">
                <input
                  value={ssid}
                  onChange={(event) => setSsid(event.target.value)}
                  placeholder="KMB-Trichy-Guest"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={`${authInputClass} font-mono`}
                />
              </AuthField>
              <p className="-mt-2 text-[12px] leading-relaxed text-muted">
                Shoppers must be on this network for a session to start. The name alone does
                not grant access — an owner adds the network&rsquo;s public IP range in the
                console before the shop goes live.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <AuthField label="Latitude">
                  <input
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                    placeholder="10.7905"
                    inputMode="decimal"
                    className={`${authInputClass} font-mono`}
                  />
                </AuthField>
                <AuthField label="Longitude">
                  <input
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                    placeholder="78.7047"
                    inputMode="decimal"
                    className={`${authInputClass} font-mono`}
                  />
                </AuthField>
              </div>
              <p className="-mt-2 text-[12px] leading-relaxed text-muted">
                Stand at the entrance and read them off Google Maps. Without them the shop
                still works, but it is listed after every located shop and shows no distance.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <AuthField label="Opens at">
                  <input
                    type="time"
                    value={opensAt}
                    onChange={(event) => setOpensAt(event.target.value)}
                    className={`${authInputClass} font-mono`}
                  />
                </AuthField>
                <AuthField label="Closes at">
                  <input
                    type="time"
                    value={closesAt}
                    onChange={(event) => setClosesAt(event.target.value)}
                    className={`${authInputClass} font-mono`}
                  />
                </AuthField>
              </div>
              <p className="-mt-2 text-[12px] leading-relaxed text-muted">
                Customers see these, and the app shows the shop as closed outside them.
                Closing after midnight is fine — set 22:00 to 02:00.
              </p>

              <AuthAlert tone="warning">
                Your shop is registered straight away but stays <strong>hidden from
                customers</strong> until an owner activates it. Nobody can put a shop in the
                customer app on their own say-so.
              </AuthAlert>
            </div>
          )}
        </div>

        <AuthSubmit busy={busy} busyLabel="Creating account…">
          Create account
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
