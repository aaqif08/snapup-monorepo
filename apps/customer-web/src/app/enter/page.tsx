'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BarcodeScanner from '@snapup/ui/BarcodeScanner';
import { startSession, GatewayError } from '@/lib/api';

type Phase = 'scanning' | 'verifying' | 'error';

/**
 * SDPA entry gate. The customer scans the store's entrance QR here; the server then
 * checks both presence factors before any session exists.
 *
 * There is no store id in this route on purpose — the signed QR already carries the
 * store identity, and it is the only copy that is tamper-evident. Taking a store id
 * from the URL as well would just create a second, forgeable source of truth.
 *
 * `?p=` carries a **signed poster token** and does not breach that rule: it is the same
 * signed payload the camera would have read, arriving over the URL bar because it was
 * printed on paper rather than shown on a screen. A phone camera can open a link; it
 * cannot open a bare token, which is why a printed code has to be a URL. The store
 * identity still comes from inside the signature, so a printed poster cannot be edited to
 * point at a different shop.
 *
 * Deliberately thin: it forwards the scanned token and renders whatever the server
 * decides. No presence logic runs on the client, because anything decided here could be
 * bypassed by someone with devtools open.
 */
export default function StoreEntryPage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route into
  // client-side rendering at build time.
  return (
    <Suspense fallback={null}>
      <StoreEntry />
    </Suspense>
  );
}

function StoreEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const posterToken = searchParams.get('p');

  const [phase, setPhase] = useState<Phase>(posterToken ? 'verifying' : 'scanning');
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(
    async (qrToken: string) => {
      // The scanner fires per frame; ignore everything after the first hit.
      if (phase !== 'scanning') return;
      setPhase('verifying');
      setError(null);

      try {
        await startSession(qrToken);
        router.replace('/scan');
      } catch (err) {
        const message =
          err instanceof GatewayError
            ? err.message
            : 'Could not verify store presence. Please try again.';
        setError(message);
        setPhase('error');
      }
    },
    [phase, router]
  );

  // Fires once, for a poster link only. `handleScan` guards on `phase === 'scanning'` and
  // the poster path starts in `verifying`, so the two entry routes cannot both run.
  const posterAttempted = useRef(false);
  useEffect(() => {
    if (!posterToken || posterAttempted.current) return;
    posterAttempted.current = true;

    (async () => {
      try {
        await startSession(posterToken);
        router.replace('/scan');
      } catch (err) {
        setError(
          err instanceof GatewayError
            ? err.message
            : 'Could not verify store presence. Please try again.'
        );
        setPhase('error');
      }
    })();
  }, [posterToken, router]);

  const retry = () => {
    setError(null);
    // A failed poster link cannot be retried by re-reading it — the token is already in
    // hand and failed. Falling back to the camera lets someone use the display code
    // instead of standing at a poster that will keep failing for the same reason.
    posterAttempted.current = true;
    setPhase('scanning');
  };

  return (
    <div className="relative flex min-h-[calc(100vh-64px)] flex-col bg-black">
      <div className="flex flex-1 items-center justify-center px-6 pb-72 pt-10">
        <div className="h-[280px] w-full max-w-sm">
          <BarcodeScanner isActive={phase === 'scanning'} onScan={handleScan} />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 rounded-t-[32px] border-t border-border bg-bg px-6 pb-10 pt-4 shadow-pop">
        <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-border" />

        {phase === 'error' ? (
          <>
            <h1 className="mb-2 text-2xl font-extrabold text-danger">Can’t start shopping</h1>
            <p className="mb-6 text-base leading-relaxed text-muted">{error}</p>
            <button
              onClick={retry}
              className="w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition duration-200 hover:bg-primaryDark active:scale-[0.99]"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-extrabold text-ink">
              {phase === 'verifying' ? 'Verifying presence…' : 'Scan the entrance code'}
            </h1>
            <p className="mb-7 text-base leading-relaxed text-muted">
              {phase === 'verifying'
                ? 'Confirming you’re inside the store.'
                : 'Point your camera at the Snap Up code on the store entrance display, and make sure you’re connected to the store Wi-Fi.'}
            </p>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">
                Security check
              </p>
              <p className="text-sm leading-relaxed text-ink">
                Snap Up verifies both the entrance code and the store network before
                unlocking product data. Both are required.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
