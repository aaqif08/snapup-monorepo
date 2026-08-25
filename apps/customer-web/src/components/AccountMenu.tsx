'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * The signed-in identity, and the only exit from a session.
 *
 * There is no idle timer and no expiry anywhere in the account path, so this button is
 * genuinely the only way out — which is why it is always reachable from the nav rather
 * than buried on a settings screen.
 */
export default function AccountMenu() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A menu that can only be dismissed by picking
  // something from it is a menu people close by navigating away.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!isAuthenticated || !user) {
    return (
      <Link
        href="/login"
        className="rounded-xl px-3 py-2 text-sm font-bold text-muted transition-colors duration-200 hover:bg-tint hover:text-ink"
      >
        Log in
      </Link>
    );
  }

  const label = user.name?.trim() || formatLocalPhone(user.phone) || 'Account';
  const initial = (user.name?.trim()?.[0] ?? label[0] ?? '?').toUpperCase();

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      setOpen(false);
      router.push('/');
      // The landing screen and the home screen are the same route, and the guard reads
      // state this component just changed — refresh so the server components re-render
      // against the cleared cookie rather than the stale one.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2.5 text-sm font-bold text-ink transition-colors duration-200 hover:bg-tint"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-onPrimary">
          {initial}
        </span>
        <span className="hidden max-w-[9rem] truncate sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 animate-fade-in-up overflow-hidden rounded-2xl border border-border bg-surface shadow-pop"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-extrabold text-ink">{label}</p>
            {user.phone && (
              <p className="mt-0.5 font-mono text-[11px] text-muted">
                {formatLocalPhone(user.phone)}
              </p>
            )}
            {user.role !== 'customer' && (
              <span className="mt-2 inline-block rounded-full bg-tint px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
                {user.role}
              </span>
            )}
          </div>

          <p className="px-4 py-2.5 text-[11px] leading-relaxed text-muted">
            You stay signed in on this device until you log out.
          </p>

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={busy}
            className="w-full border-t border-border px-4 py-3 text-left text-sm font-extrabold text-danger transition-colors duration-200 hover:bg-danger/5 disabled:opacity-50"
          >
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}

/** `919876543210` -> `+91 98765 43210`. Display only. */
function formatLocalPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.startsWith('91') && phone.length === 12) {
    return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
  }
  return `+${phone}`;
}
