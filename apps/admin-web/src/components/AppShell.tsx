'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from '@snapup/ui/ThemeToggle';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

const NAV_LINKS = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/insights', label: 'Insights', icon: '📈' },
  { href: '/stores', label: 'Stores', icon: '🏪' },
  { href: '/products', label: 'Products', icon: '📦' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const { isAuthenticated, email, logout } = useAdminAuthStore();

  useEffect(() => {
    useAdminAuthStore.persist.rehydrate();
    setIsHydrated(true);
  }, []);

  // Route guard: every screen except /login requires an authenticated session.
  useEffect(() => {
    if (isHydrated && !isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    }
  }, [isHydrated, isAuthenticated, pathname, router]);

  if (!isHydrated) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (pathname === '/login' || !isAuthenticated) {
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
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex-1 px-3 py-4">
          {NAV_LINKS.map((link) => {
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
            onClick={() => {
              logout();
              router.push('/login');
            }}
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
              onClick={() => {
                logout();
                router.push('/login');
              }}
              className="rounded-xl px-3 py-2 text-xs font-bold text-danger transition-colors duration-200 hover:bg-danger/10"
            >
              Log Out
            </button>
          </div>
        </header>

        <main className="flex-1 pb-24 lg:pb-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          {NAV_LINKS.map((link) => {
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
