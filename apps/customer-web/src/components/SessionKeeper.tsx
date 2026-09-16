'use client';

import { useEffect } from 'react';
import { keepSessionAlive } from '@/lib/api';
import { useSessionStore } from '@/store/useSessionStore';

/** How often the clock is consulted. Coarse on purpose; the server does the deciding. */
const CHECK_INTERVAL_MS = 10_000;

/**
 * Keeps a session alive for as long as the customer is actually in the shop.
 *
 * Renewal used to live on the scan page alone, so a customer who spent the last minute of
 * their session in the cart, at checkout, or reading a product page had it expire under
 * them — and came back to the scanner to find it refusing every barcode. This runs from
 * the app chrome, on every screen, and does nothing until the session is in its final
 * minute or just past it.
 *
 * It also listens for the phone waking. A device asleep in a pocket does not fire timers
 * on schedule; the moment its screen comes back is the moment to ask, before the customer
 * has scanned anything and been refused. `pageshow` covers the back-forward cache, where
 * a restored page fires no visibility change.
 *
 * Renders nothing. The cart is not consulted and not changed.
 */
export default function SessionKeeper() {
  const status = useSessionStore((state) => state.status);
  const expiresAtMs = useSessionStore((state) => state.expiresAtMs);

  useEffect(() => {
    if (status !== 'active' || !expiresAtMs) return;

    const check = () => void keepSessionAlive();
    const onWake = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, [status, expiresAtMs]);

  return null;
}
