'use client';

import { usePathname } from 'next/navigation';
import BottomNav from '@/components/BottomNav';

/**
 * Decides whether a route gets the app chrome.
 *
 * The bar is hidden on the screens that are not *in* the app yet — the landing choice and
 * sign-in — because offering Cart and Offers to somebody who has not chosen a shop yet
 * leads them to four empty screens. Everything else gets it, including Scan, where the
 * design keeps the bar visible with the FAB in its active state.
 */
const BARE_ROUTES = ['/login'];

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((route) => pathname.startsWith(route));

  return (
    <>
      {/* `pb-20` reserves the bar's height so a page's last element is never trapped
          under it — the bar is fixed, so it takes no space in the flow of its own. */}
      <main className={`flex-1 ${bare ? '' : 'pb-20'}`}>{children}</main>
      {!bare && <BottomNav />}
    </>
  );
}
