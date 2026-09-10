'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startSession, GatewayError } from '@/lib/api';

/**
 * Starts the session for a shopper who arrived from a printed poster.
 *
 * Deliberately shows the shop's network name in the failure case. The overwhelmingly most
 * likely reason this fails is that the phone is still on mobile data — the poster was
 * scanned before the Wi-Fi code, or the join silently did not take — and a message naming
 * the network the shopper needs is the difference between fixing it and giving up.
 */
export default function PosterEntry({
  token,
  storeName,
  ssid,
}: {
  token: string;
  storeName: string;
  ssid: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  /** The address the gateway saw, when it refuses on presence. */
  const [observedIp, setObservedIp] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        await startSession(token);
        router.replace('/scan');
      } catch (err) {
        setError(
          err instanceof GatewayError
            ? err.message
            : 'Could not reach Snap Up. Check that you are connected to the shop Wi-Fi.'
        );
        if (err instanceof GatewayError && typeof err.detail.observed_ip === 'string') {
          setObservedIp(err.detail.observed_ip);
        }
      }
    })();
  }, [token, router]);

  return (
    <main className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center px-6 text-center">
      {error ? (
        <>
          <h1 className="mb-3 text-2xl font-extrabold text-danger">Can’t start shopping</h1>
          <p className="mb-6 max-w-sm text-base leading-relaxed text-muted">{error}</p>
          <div className="mb-6 w-full max-w-sm rounded-2xl border border-border bg-surface p-5 text-left">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">
              Check first
            </p>
            <p className="text-sm leading-relaxed text-ink">
              Your phone must be on <span className="font-mono font-bold">{ssid}</span>, the
              Wi-Fi inside {storeName}. Mobile data will not work — that is the check that
              proves you are in the shop.
            </p>
            {observedIp && (
              // If this shows while the phone really is on the shop Wi-Fi, the shop's
              // public address has changed and the branch needs re-registering. That is
              // staff's problem, not the shopper's, and it is worth being able to read
              // out over a counter rather than diagnose.
              <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">
                We saw your connection as{' '}
                <span className="font-mono font-bold text-ink">{observedIp}</span>, which is
                not registered for this shop. If you are already on {ssid}, show this to a
                member of staff.
              </p>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full max-w-sm rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition duration-200 hover:bg-primaryDark active:scale-[0.99]"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <div className="mb-5 h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
          <h1 className="text-xl font-extrabold text-ink">Starting your session…</h1>
          <p className="mt-2 text-sm text-muted">{storeName}</p>
        </>
      )}
    </main>
  );
}
