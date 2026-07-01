'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/products', label: 'Products', icon: '📦' },
  { href: '/staff', label: 'Staff', icon: '👥' },
  { href: '/security', label: 'Security', icon: '🛡️' },
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
    <div className="flex min-h-screen bg-[#F4F7F6]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-6 py-5">
          <Image src="/logo-mark.png" alt="SnapUp" width={28} height={28} />
          <div>
            <p className="text-sm font-extrabold text-ink">SnapUp Business</p>
            <p className="text-xs text-muted">{email}</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-bg hover:text-ink'
                }`}
              >
                <span>{link.icon}</span>
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
            className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold text-danger hover:bg-danger/10"
          >
            Log Out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="SnapUp" width={24} height={24} />
            <span className="text-sm font-extrabold text-ink">SnapUp Business</span>
          </div>
          <button
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="text-xs font-bold text-danger"
          >
            Log Out
          </button>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface lg:hidden">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${
                  isActive ? 'text-primary' : 'text-muted'
                }`}
              >
                <span className="text-base">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
