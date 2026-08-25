'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@snapup/ui/ThemeToggle';
import ScreenHeader from '@/components/ScreenHeader';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * My Account.
 *
 * The design shows a plain list of rows. Most of them lead to screens that do not exist
 * yet, so rather than wiring dead links each one says what it is for and is marked as not
 * built — a row that silently does nothing is the most annoying thing a settings screen
 * can contain.
 *
 * Log Out is real, and it is the only way an account session ends: there is no expiry
 * anywhere on the account path by product decision.
 */
export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useAuthStore.persist.rehydrate();
    void hydrate();
  }, [hydrate]);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      router.push('/');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="My Account" trailing={<ThemeToggle />} />

      <div className="flex flex-col items-center px-4 pt-4">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-bg text-muted">
          {user?.name ? (
            <span className="text-3xl font-extrabold text-primary">
              {user.name.trim()[0]?.toUpperCase()}
            </span>
          ) : (
            <svg viewBox="0 0 24 24" className="h-16 w-16" fill="currentColor" aria-hidden>
              <circle cx="12" cy="9.5" r="3.6" />
              <path d="M5 19.5a7 7 0 0 1 14 0z" />
            </svg>
          )}
        </div>

        {isAuthenticated && user ? (
          <>
            <p className="mt-3 text-lg font-extrabold text-ink">{user.name ?? 'Your account'}</p>
            {user.phone && (
              <p className="mt-0.5 font-mono text-xs text-muted">{formatPhone(user.phone)}</p>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-base font-bold text-ink">You are not signed in</p>
            <Link
              href="/login?redirect=/account"
              className="mt-3 rounded-2xl bg-primary px-6 py-2.5 text-sm font-extrabold text-onPrimary"
            >
              Sign in with your mobile
            </Link>
          </>
        )}
      </div>

      <div className="mt-8 px-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <Row icon={<PersonIcon />} label="Edit Profile" soon />
          <Row icon={<HomeIcon />} label="My Address" soon />
          <Row icon={<CardIcon />} label="Payment Method" soon />
          <Row icon={<BellIcon />} label="Notifications" soon />
          <Row icon={<InfoIcon />} label="Help & Support" soon />
          <Row icon={<QuestionIcon />} label="About SnapUp" soon />

          {isAuthenticated && (
            <button
              onClick={() => void handleLogout()}
              disabled={busy}
              className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-left transition-colors hover:bg-danger/5 disabled:opacity-50"
            >
              <span className="text-danger">
                <LogoutIcon />
              </span>
              <span className="text-sm font-bold text-danger">
                {busy ? 'Logging out…' : 'Log Out'}
              </span>
            </button>
          )}
        </div>

        <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted">
          You stay signed in on this device until you log out. There is no automatic
          sign-out.
        </p>
      </div>
    </div>
  );
}

function Row({ icon, label, soon }: { icon: React.ReactNode; label: string; soon?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
      <span className="text-muted">{icon}</span>
      <span className="flex-1 text-sm font-semibold text-ink">{label}</span>
      {soon && (
        <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
          Soon
        </span>
      )}
    </div>
  );
}

/** `919876543210` -> `+91 98765 43210`. Display only. */
function formatPhone(phone: string): string {
  if (phone.startsWith('91') && phone.length === 12) {
    return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
  }
  return `+${phone}`;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6 18.5a6.5 6.5 0 0 1 12 0" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <path d="M4 21V9l8-6 8 6v12z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <path d="M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6h.01" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4M12 17h.01" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 8l4 4-4 4M20 12H10" />
    </svg>
  );
}
