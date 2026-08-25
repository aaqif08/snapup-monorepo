'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@snapup/ui/ThemeToggle';
import { useEffect } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/scan', label: 'Scan' },
  { href: '/cart', label: 'Cart' },
];

export default function NavBar() {
  const pathname = usePathname();
  const itemCount = useCartStore((state) => state.items.reduce((acc, item) => acc + item.quantity, 0));
  const hasEnteredApp = useAuthStore((state) => state.hasEnteredApp);
  const isReady = useAuthStore((state) => state.isReady);
  const hydrate = useAuthStore((state) => state.hydrate);

  // The nav is on every in-app screen, so this is the one place guaranteed to run
  // wherever the customer lands — deep-linking straight to /cart included.
  useEffect(() => {
    if (!isReady) void hydrate();
  }, [isReady, hydrate]);

  // The Landing choice screen (Guest vs. Login) is a pre-app gate, not an
  // in-app screen — it shouldn't show the Home/Scan/Cart nav.
  if (pathname === '/' && !hasEnteredApp) {
    return null;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-xl px-1 py-1 transition-opacity hover:opacity-80"
        >
          <Image src="/logo-mark.png" alt="" width={28} height={28} className="h-7 w-auto" priority />
          <span className="text-lg font-extrabold tracking-tight text-ink">SnapUp</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative rounded-xl px-3 py-2 text-sm font-bold transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted hover:bg-tint hover:text-ink'
                }`}
              >
                {link.label}
                {link.href === '/cart' && itemCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold text-onPrimary shadow-card">
                    {itemCount}
                  </span>
                )}
              </Link>
            );
          })}
          <ThemeToggle className="ml-1" />
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}
