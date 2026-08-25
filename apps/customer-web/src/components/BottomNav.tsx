'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCartStore } from '@/store/useCartStore';

/**
 * The five-tab bar, with Scan raised into the middle.
 *
 * Scan is not a tab. It is the one thing the whole product exists to do, so it is a
 * circular button that breaks the bar's top edge rather than a fifth equal icon — which is
 * what the design does and what makes it reachable with a thumb while holding a basket.
 *
 * The other four are arranged two-and-two around it. That ordering is load-bearing: the
 * two on the left are what you consult *during* a shop, the two on the right are what you
 * consult between shops.
 */

const LEFT = [
  { href: '/cart', label: 'My Cart', icon: CartIcon },
  { href: '/bills', label: 'My Bills', icon: BillsIcon },
];

const RIGHT = [
  { href: '/offers', label: 'Offers', icon: OffersIcon },
  { href: '/account', label: 'Profile', icon: ProfileIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  const itemCount = useCartStore((state) =>
    state.items.reduce((total, item) => total + item.quantity, 0)
  );

  const scanActive = pathname === '/scan';

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch">
        {LEFT.map((tab) => (
          <Tab key={tab.href} {...tab} active={pathname === tab.href} badge={tab.href === '/cart' ? itemCount : 0} />
        ))}

        {/* The FAB overflows the bar upward, so the bar itself keeps a plain rectangular
            hit area and only this element is raised. */}
        <div className="relative w-20 shrink-0">
          <Link
            href="/scan"
            aria-label="Scan"
            aria-current={scanActive ? 'page' : undefined}
            className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-5 flex-col items-center"
          >
            <span
              className={`flex h-16 w-16 items-center justify-center rounded-full shadow-pop ring-4 ring-surface transition-colors duration-200 ${
                scanActive ? 'bg-primaryDark' : 'bg-primary'
              }`}
            >
              <ScanIcon className="h-7 w-7 text-onPrimary" />
            </span>
            <span
              className={`mt-1 text-[11px] font-bold ${scanActive ? 'text-primary' : 'text-muted'}`}
            >
              Scan
            </span>
          </Link>
        </div>

        {RIGHT.map((tab) => (
          <Tab key={tab.href} {...tab} active={pathname === tab.href} badge={0} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  active: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-200 ${
        active ? 'text-primary' : 'text-muted hover:text-ink'
      }`}
    >
      <span className="relative">
        <Icon className="h-6 w-6" />
        {badge > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold text-onPrimary">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="text-[11px] font-bold">{label}</span>
    </Link>
  );
}

/* Inline SVGs rather than an icon package: five icons is not worth 40 kB of dependency,
   and `currentColor` is what lets them follow the active/inactive token without a prop. */

function CartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.55L21 8H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
    </svg>
  );
}

function BillsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

function OffersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5l2.1 1.6 2.6-.3 1 2.4 2.3 1.2-.6 2.6 1.6 2.1-1.6 2.1.6 2.6-2.3 1.2-1 2.4-2.6-.3L12 21.5l-2.1-1.6-2.6.3-1-2.4-2.3-1.2.6-2.6L3 12l1.6-2.1-.6-2.6 2.3-1.2 1-2.4 2.6.3z" />
      <path d="M9.5 14.5l5-5M9.6 9.6h.01M14.4 14.4h.01" />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M5.5 19a7 7 0 0 1 13 0" />
    </svg>
  );
}

export function ScanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="14" width="2.5" height="2.5" rx="0.6" />
      <rect x="18.5" y="14" width="2.5" height="2.5" rx="0.6" />
      <rect x="14" y="18.5" width="2.5" height="2.5" rx="0.6" />
      <rect x="18.5" y="18.5" width="2.5" height="2.5" rx="0.6" />
    </svg>
  );
}
