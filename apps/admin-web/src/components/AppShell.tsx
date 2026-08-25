'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import ThemeToggle from '@snapup/ui/ThemeToggle';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

/** Screens reachable without a session, because they are how you come to have one. */
const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password'];

const NAV_LINKS = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/insights', label: 'Insights', icon: '📈' },
  { href: '/stores', label: 'Stores', icon: '🏪' },
  { href: '/products', label: 'Products', icon: '📦' },
  // No minRole: the exit desk is the one screen a floor-staff account exists to use, and
  // hiding it from them would leave the role with nothing it can do.
  { href: '/verify', label: 'Exit desk', icon: '✅' },
  // Manager-and-above only; filtered below rather than hidden by CSS, so a staff account
  // is not shown a door it cannot open.
  { href: '/staff', label: 'Staff', icon: '👥', minRole: 'manager' as const },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isReady, user, hydrate, logout } = useAdminAuthStore();

  // The session lives in an httpOnly cookie, so the only way to know who is signed in is
  // to ask. Nothing renders until it answers — the previous store read a localStorage
  // boolean, which is why "logged in" used to be something a visitor could set themselves.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Route guard: every screen outside PUBLIC_ROUTES requires an authenticated session.
  //
  // The list matters as much as the guard. Sign-up and password recovery are reached by
  // people who by definition have no session, so guarding them redirects the user to a
  // login page they cannot get past — and a reset link that bounces to /login is a reset
  // link that does not work.
  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (isReady && !isAuthenticated && !isPublic) {
      router.replace('/login');
    }
  }, [isReady, isAuthenticated, isPublic, router]);

  const email = user?.email ?? null;
  const role = user?.role ?? null;

  const visibleLinks = NAV_LINKS.filter(
    (link) => !link.minRole || role === 'owner' || role === 'manager'
  );

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (!isReady) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (isPublic || !isAuthenticated) {
    return <main className="min-h-screen bg-bg">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-5 py-5">
          <Image src="/logo-mark.png" alt="" width={28} height={28} className="h-7 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-ink">SnapUp Business</p>
            <p className="truncate text-xs text-muted">{email}</p>
            {/* The role is what decides which screens exist and which buttons work, so it
                belongs where it can be seen rather than inferred from what is missing. */}
            {role && (
              <span className="mt-1 inline-block rounded-full bg-tint px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
                {role}
              </span>
            )}
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex-1 px-3 py-4">
          {visibleLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted hover:bg-tint hover:text-ink'
                }`}
              >
                {/* The active rail reads at a glance from across a desk, which a colour
                    change alone does not. */}
                {isActive && (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-primary" aria-hidden />
                )}
                <span aria-hidden>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <button
            onClick={() => void handleLogout()}
            className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold text-danger transition-colors duration-200 hover:bg-danger/10"
          >
            Log Out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="" width={24} height={24} className="h-6 w-auto" />
            <span className="text-sm font-extrabold text-ink">SnapUp Business</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => void handleLogout()}
              className="rounded-xl px-3 py-2 text-xs font-bold text-danger transition-colors duration-200 hover:bg-danger/10"
            >
              Log Out
            </button>
          </div>
        </header>

        <main className="flex-1 pb-24 lg:pb-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          {visibleLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold transition-colors duration-200 ${
                  isActive ? 'text-primary' : 'text-muted hover:text-ink'
                }`}
              >
                <span className="text-base" aria-hidden>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
