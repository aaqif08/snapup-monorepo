'use client';

import Image from 'next/image';
import ThemeToggle from '@snapup/ui/ThemeToggle';

/**
 * The frame every unauthenticated console screen sits in.
 *
 * Extracted because there are now four of them — sign in, sign up, forgot password, reset
 * password — and four hand-copied variants of the same card is how they drift apart. The
 * theme toggle in particular has to be here: the app shell's copy lives behind the auth
 * guard, so without one these screens are stuck in whichever theme the OS prefers.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
  width = 'sm',
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md';
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-primary px-6 py-12">
      {/* Soft wash so the flat brand colour has some depth on a large screen. */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-onPrimary/10 blur-3xl"
        aria-hidden
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle className="border-onPrimary/30 text-onPrimary hover:border-onPrimary hover:text-onPrimary" />
      </div>

      <div
        className={`relative w-full animate-scale-in rounded-3xl bg-surface p-8 shadow-pop ${
          width === 'md' ? 'max-w-md' : 'max-w-sm'
        }`}
      >
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-tint">
            <Image src="/logo-mark.png" alt="" width={36} height={36} className="h-9 w-auto" />
          </div>
          <h1 className="text-xl font-extrabold text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-center text-sm leading-relaxed text-muted">{subtitle}</p>
          )}
        </div>

        {children}

        {footer && <div className="mt-6 border-t border-border pt-5">{footer}</div>}
      </div>
    </div>
  );
}

/** The text input used across all four screens, so they cannot drift apart. */
export const authInputClass =
  'w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary disabled:opacity-60';

export function AuthField({
  label,
  htmlFor,
  children,
  error,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
      {/* Inline, next to the field it belongs to, rather than collected at the bottom of
          the form where the reader has to work out which input it refers to. */}
      {error && <p className="mt-1.5 text-[11px] font-bold text-danger">{error}</p>}
    </div>
  );
}

export function AuthAlert({
  tone,
  children,
}: {
  tone: 'error' | 'warning' | 'success';
  children: React.ReactNode;
}) {
  const style =
    tone === 'error'
      ? 'border-danger/40 bg-danger/5 text-danger'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-primary/30 bg-primary/5 text-primary';

  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-3 py-2.5 text-[12px] font-semibold leading-relaxed ${style}`}
    >
      {children}
    </p>
  );
}

export function AuthSubmit({
  children,
  disabled,
  busyLabel,
  busy,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  busyLabel?: string;
  busy?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      className="w-full rounded-xl bg-accent py-3.5 text-sm font-extrabold text-onAccent transition duration-200 hover:opacity-90 disabled:opacity-50"
    >
      {busy ? (busyLabel ?? 'Please wait…') : children}
    </button>
  );
}
