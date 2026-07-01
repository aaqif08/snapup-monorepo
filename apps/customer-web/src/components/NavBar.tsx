'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

  // The Landing choice screen (Guest vs. Login) is a pre-app gate, not an
  // in-app screen — it shouldn't show the Home/Scan/Cart nav.
  if (pathname === '/' && !hasEnteredApp) {
    return null;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          {/* ✅ FIX APPLIED HERE: Added w-auto and h-auto to respect Next.js aspect-ratio rules */}
          <Image 
            src="/logo-mark.png" 
            alt="SnapUp" 
            width={28} 
            height={28} 
            className="w-auto h-auto" 
            priority 
          />
          <span className="text-lg font-extrabold text-ink">SnapUp</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                  isActive ? 'text-primary' : 'text-muted hover:text-ink'
                }`}
              >
                {link.label}
                {link.href === '/cart' && itemCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-extrabold text-white">
                    {itemCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}