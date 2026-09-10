'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BarcodeScanner from '@snapup/ui/BarcodeScanner';
import { startSession, GatewayError } from '@/lib/api';
import { classifyScannedEntry, WIFI_CODE_MESSAGE } from '@/lib/entryCode';

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
  /** What the camera actually read, shown when the server rejects it. */
  const [scannedText, setScannedText] = useState<string | null>(null);

  const handleScan = useCallback(
    async (scanned: string) => {
      // The scanner fires per frame; ignore everything after the first hit.
      if (phase !== 'scanning') return;
      setPhase('verifying');
      setError(null);

      const text = scanned.trim();
      const entry = classifyScannedEntry(text);

      if (entry.kind === 'wifi') {
        setError(WIFI_CODE_MESSAGE);
        setScannedText(text);
        setPhase('error');
        return;
      }

      if (entry.kind === 'poster') {
        router.replace(`/p/${entry.code}`);
        return;
      }

      try {
        await startSession(entry.token);
        router.replace('/scan');
      } catch (err) {
        const message =
          err instanceof GatewayError
            ? err.message
            : 'Could not verify store presence. Please try again.';
        setError(message);
        // "This entrance code is not valid" says nothing about which code was read, and in
        // a shop that is the only thing worth knowing — a Wi-Fi code, an old poster, a
        // product barcode and a genuine expired token all produce the same sentence.
        setScannedText(text);
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

  const [manualCode, setManualCode] = useState('');
  const submitManualCode = (event: React.FormEvent) => {
    event.preventDefault();
    const code = manualCode.trim().toUpperCase();
    if (/^[0-9A-Z]{8}$/.test(code)) router.replace(`/p/${code}`);
    else setError('That code should be the 8 letters and numbers printed under the poster’s second QR.');
  };

  const retry = () => {
    setError(null);
    // A failed poster link cannot be retried by re-reading it — the token is already in
    // hand and failed. Falling back to the camera lets someone use the display code
    // instead of standing at a poster that will keep failing for the same reason.
    posterAttempted.current = true;
    setScannedText(null);
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
            <p className="mb-4 text-base leading-relaxed text-muted">{error}</p>
            {scannedText && (
              <div className="mb-6 rounded-2xl border border-border bg-surface p-4 text-left">
                <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">
                  What the camera read
                </p>
                <p className="break-all font-mono text-xs text-ink">
                  {scannedText.slice(0, 60)}
                  {scannedText.length > 60 ? '…' : ''}
                </p>
              </div>
            )}
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

            {/* The camera is the fast path, not the only one. A code that will not scan --
                bad light, a scratched poster, a phone whose autofocus gives up -- otherwise
                leaves the shopper with nothing to try, and "it will not scan" is the one
                failure they cannot work around on their own. */}
            {phase === 'scanning' && (
              <form onSubmit={submitManualCode} className="mb-6">
                <label className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-muted">
                  Or type the code printed on the poster
                </label>
                <div className="flex gap-2">
                  <input
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder="ABCD1234"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={8}
                    className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-center font-mono text-lg font-bold uppercase tracking-widest text-ink"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-2xl bg-primary px-5 py-3 text-sm font-extrabold text-onPrimary active:scale-[0.99]"
                  >
                    Go
                  </button>
                </div>
              </form>
            )}

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
