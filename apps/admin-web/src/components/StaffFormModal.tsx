'use client';

import { useState } from 'react';
import { AccountError, createStaff, updateStaff, type AccountUser, type Role } from '@/lib/accountClient';

type Editable = Exclude<Role, 'customer'>;

const MIN_PASSWORD = 10;

const ROLE_OPTIONS: { value: Editable; label: string; blurb: string }[] = [
  { value: 'owner', label: 'Owner', blurb: 'Everything, including staff and store settings.' },
  { value: 'manager', label: 'Manager', blurb: 'Products, stores and analytics. No staff access.' },
  { value: 'staff', label: 'Staff', blurb: 'Exit verification and read-only catalogue.' },
];

export default function StaffFormModal({
  initial,
  isSelf,
  onClose,
  onSaved,
}: {
  initial?: AccountUser;
  isSelf?: boolean;
  onClose: () => void;
  onSaved: (notice?: string) => void;
}) {
  const editing = initial !== undefined;

  const [email, setEmail] = useState(initial?.email ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [role, setRole] = useState<Editable>((initial?.role as Editable) ?? 'staff');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!editing) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Enter a valid work email address.');
        return;
      }
      if (password.length < MIN_PASSWORD) {
        setError(`Password must be at least ${MIN_PASSWORD} characters.`);
        return;
      }
    } else if (password && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    try {
      if (!editing) {
        await createStaff({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          role,
        });
        onSaved('Account created. Give them their password directly — it cannot be shown again.');
        return;
      }

      await updateStaff(initial.id, {
        name: name.trim() || null,
        phone: phone.trim() || null,
        // Email is not editable: it is the sign-in identity, and changing it silently
        // moves an account to a different person. Removing and re-adding is the honest
        // path, and it leaves a trail.
        ...(isSelf ? {} : { role }),
        ...(password ? { password } : {}),
      });
      onSaved(password ? 'Saved. Give them the new password directly.' : 'Saved.');
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/50 backdrop-blur-sm sm:items-center">
      <div className="my-8 w-full max-w-md animate-fade-in-up rounded-t-3xl border border-border bg-surface p-6 shadow-pop sm:rounded-3xl">
        <h2 className="mb-1 text-lg font-extrabold text-ink">
          {editing ? `Edit ${initial.name?.trim() || initial.email}` : 'Add staff'}
        </h2>
        <p className="mb-5 text-xs text-muted">
          {editing
            ? 'Email cannot be changed — it is how they sign in.'
            : 'They will sign in to this console with the email and password you set.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Work email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={editing}
              placeholder="colleague@kurinji.in"
              autoComplete="off"
              className={`${inputClass} disabled:opacity-60`}
            />
          </Field>

          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </Field>

          <Field label="Mobile number">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional — also lets them use the customer app"
              className={inputClass}
            />
          </Field>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-muted">Role</label>
            <div className="space-y-1.5">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    role === option.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  } ${isSelf ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={role === option.value}
                    disabled={isSelf}
                    onChange={() => setRole(option.value)}
                    className="mt-0.5 h-4 w-4 accent-[color:var(--color-primary,#0a7)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold text-ink">{option.label}</span>
                    <span className="block text-[11px] leading-relaxed text-muted">
                      {option.blurb}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {/* The server refuses this too. Explaining it here means an owner understands
                the rule rather than hitting a wall and assuming the form is broken. */}
            {isSelf && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                You cannot change your own role. Ask another owner to do it — otherwise a
                single mistake locks everybody out of staff management.
              </p>
            )}
          </div>

          <Field label={editing ? 'Set a new password (optional)' : 'Password'}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing ? 'Leave blank to keep the current one' : '••••••••••'}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>

          <p className="-mt-1 text-[11px] leading-relaxed text-muted">
            At least {MIN_PASSWORD} characters. It is stored hashed and shown only here, so
            pass it on directly — there is no way to recover it later, only to set a new one.
          </p>

          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-extrabold text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-muted">{label}</label>
      {children}
    </div>
  );
}
