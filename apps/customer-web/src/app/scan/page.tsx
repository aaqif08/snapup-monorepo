'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BarcodeScanner from '@snapup/ui/BarcodeScanner';
import ScanToast from '@/components/ScanToast';
import ScreenHeader from '@/components/ScreenHeader';
import SessionTimer, { Pill } from '@/components/SessionTimer';
import { useCartStore, type Product } from '@/store/useCartStore';
import { useSessionStore } from '@/store/useSessionStore';
import {
  lookupBarcode,
  sendHeartbeat,
  startSession,
  GatewayError,
  type LookupResult,
} from '@/lib/api';

/**
 * How often to re-confirm presence. Trades server load against how quickly a departed
 * customer sees the session end. Enforcement is per-request regardless — see session.ts.
 */
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * The scanner.
 *
 * One screen doing two jobs, decided by whether a session exists: with none it points the
 * customer at the entrance code, with one it reads barcodes. That is what the design shows
 * and it is the right shape — the mental model is "point the phone at the thing", and
 * which thing depends only on where you are in the shop.
 *
 * The viewfinder is a light card with mint corner brackets rather than a full-bleed black
 * camera, matching the design. The feed still fills it; the brackets say where to aim.
 */
export default function ScanPage() {
  const router = useRouter();

  const [isScanning, setIsScanning] = useState(true);
  const [lastScanned, setLastScanned] = useState<Product | null>(null);
  const [lastTiming, setLastTiming] = useState<LookupResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [counterPulse, setCounterPulse] = useState(false);
  const [entering, setEntering] = useState(false);
  /** Set when the camera cannot start, so manual entry is offered instead of nothing. */
  const [cameraFault, setCameraFault] = useState(false);
  const [manualCode, setManualCode] = useState('');
  /**
   * What the server has told us about this device's network, if anything.
   *
   * `unknown` until an entrance code is redeemed — the check happens there, not here,
   * and a client-side guess about Wi-Fi is exactly the kind of claim that sends someone
   * walking round a shop believing they are connected.
   */
  const [network, setNetwork] = useState<'unknown' | 'rejected'>('unknown');

  const addProduct = useCartStore((state) => state.addProduct);
  const cartItems = useCartStore((state) => state.items);
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  const status = useSessionStore((state) => state.status);
  const storeName = useSessionStore((state) => state.storeName);
  const expiresAt = useSessionStore((state) => state.expiresAt);
  const invalidate = useSessionStore((state) => state.invalidate);

  // Rehydrate before deciding anything, or the first client render always looks like "no
  // session" and flashes the wrong screen at someone mid-shop.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    useSessionStore.persist.rehydrate();
    useCartStore.persist.rehydrate();
    setHydrated(true);
  }, []);

  const active = hydrated && status === 'active';

  useEffect(() => {
    if (hydrated && status !== 'active') setIsScanning(false);
  }, [hydrated, status]);

  // Continuous presence validation.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  const prevCount = useRef(itemCount);
  useEffect(() => {
    if (itemCount > prevCount.current) {
      setCounterPulse(true);
      const timer = setTimeout(() => setCounterPulse(false), 320);
      prevCount.current = itemCount;
      return () => clearTimeout(timer);
    }
    prevCount.current = itemCount;
  }, [itemCount]);

  /**
   * First job: turn the shop's entrance code into a session.
   *
   * The screen previously told the customer to point their camera at the entrance code
   * and then rendered no camera — the instruction was real, the means were not, and the
   * only route to `/enter` was from a store page nothing linked to. Scanning here closes
   * that loop, and `startSession` writes the session store itself, so a success needs no
   * navigation: `active` flips and the same viewfinder starts reading products.
   */
  const handleEntryScan = useCallback(
    async (qrToken: string) => {
      if (entering) return;
      setEntering(true);
      setScanError(null);

      try {
        await startSession(qrToken);
      } catch (error) {
        // The gateway distinguishes "your code is fine but you are not on our network" from
        // every other failure, and that is the one a customer can act on.
        if (error instanceof GatewayError && error.code === 'presence_not_verified') {
          setNetwork('rejected');
        }
        setScanError(
          error instanceof GatewayError
            ? error.message
            : 'Couldn’t verify you’re in the shop. Check you’re on the store Wi-Fi and try again.'
        );
        setEntering(false);
      }
    },
    [entering]
  );

  const handleScan = useCallback(
    async (barcode: string) => {
      if (!isScanning) return;
      setIsScanning(false);
      setScanError(null);

      try {
        const result = await lookupBarcode(barcode);
        // A beat before the cart add, so the scanner's own detect-flash plays before the
        // UI shifts underneath it.
        setTimeout(() => {
          addProduct(result.product);
          setLastScanned(result.product);
          setLastTiming(result);
        }, 180);
      } catch (error) {
        if (error instanceof GatewayError && error.code === 'product_not_found') {
          setScanError('That item isn’t in this store’s catalogue.');
        } else if (error instanceof GatewayError && error.code === 'rate_limited') {
          setScanError('Slow down a moment — too many scans at once.');
        } else if (error instanceof GatewayError) {
          // Presence and expiry failures already tore the session down inside the api
          // layer; the expired state below explains it, so nothing more is needed here.
          setScanError(null);
        } else {
          setScanError('Couldn’t reach the store. Check your connection and try again.');
        }
        setIsScanning(true);
      }
    },
    [isScanning, addProduct]
  );

  if (!hydrated) return <div className="min-h-[60vh] bg-bg" />;

  const expired = status === 'expired' || status === 'presence_lost';

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="" onBack={() => router.push('/')} />

      {/* Timer and status sit above the viewfinder, as the design has them. */}
      <div className="flex min-h-[68px] flex-col items-center gap-2 px-4">
        {active && expiresAt && (
          <SessionTimer
            expiresAt={expiresAt}
            onExpire={() => {
              invalidate('expired');
              setIsScanning(false);
            }}
          />
        )}

        {!active &&
          (expired ? (
            <>
              <p className="font-mono text-2xl font-extrabold tabular-nums text-danger">00:00</p>
              <Pill tone="danger">
                Session <strong className="font-extrabold">Expired</strong>, Scan again to continue
              </Pill>
            </>
          ) : (
            // The design shows "Wifi Connected Successfully" here, and this reports what is
            // actually known rather than asserting it. Before a session exists nothing has
            // checked the network — presence is verified server-side when the entrance code
            // is redeemed — so claiming a successful connection would be a guess the
            // customer is about to act on. It says so only once the server has confirmed it,
            // and says the opposite when a start was refused for that reason.
            <Pill tone={network === 'rejected' ? 'danger' : undefined}>
              {network === 'rejected' ? (
                <>
                  Not on the store <strong className="font-extrabold">Wi-Fi</strong> — connect and
                  scan again
                </>
              ) : (
                <>Connect to the store Wi-Fi, then scan the entrance code</>
              )}
            </Pill>
          ))}

        {active && storeName && (
          <Pill tone="success">
            Wifi Connected{' '}
            <strong className="ml-1 font-extrabold text-primary">Successfully</strong>
          </Pill>
        )}
      </div>

      {/* ---- Viewfinder ---- */}
      <div className="px-4 pt-3">
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl bg-bg">
          {/* One camera, two jobs: without a session it reads the entrance code, with one
              it reads products. Remounted between the two so the decode callback can
              never be the wrong one for the current state. */}
          <BarcodeScanner
            key={active ? 'products' : 'entry'}
            isActive={active ? isScanning : !entering}
            onScan={active ? handleScan : handleEntryScan}
            onError={() => setCameraFault(true)}
          />

          {/* Purely an aiming guide, so hidden from assistive tech — the text above
              already says what to do. */}
          <Brackets dimmed={!active} />
        </div>

        {!active && !cameraFault && (
          <p className="pt-2.5 text-center text-[13px] leading-relaxed text-muted">
            {entering
              ? 'Checking you’re inside the shop…'
              : expired
                ? 'Your session ended. Scan the entrance code to start a new one.'
                : 'Point your camera at the entrance code displayed in the shop, and make sure you’re on the store Wi-Fi.'}
          </p>
        )}

        <div className="flex items-center justify-end pt-2">
          <Link href="/guidelines" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary text-[9px] font-extrabold text-primary">
              i
            </span>
            Guidelines
          </Link>
        </div>
      </div>

      {/* ---- Live state ---- */}
      <div className="px-4 pt-4">
        {scanError && (
          <p role="alert" className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
            {scanError}
          </p>
        )}

        {active && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-extrabold uppercase tracking-wide text-muted">
                {storeName ?? 'Your shop'}
              </p>
              <p
                className={`text-base font-extrabold text-ink transition-transform ${
                  counterPulse ? 'scale-110 text-primary' : 'scale-100'
                }`}
                style={{ transitionDuration: counterPulse ? '120ms' : '200ms' }}
              >
                {itemCount} item{itemCount === 1 ? '' : 's'} in cart
              </p>
            </div>

            {itemCount > 0 ? (
              <Link
                href="/cart"
                className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-xs font-extrabold text-onPrimary"
              >
                View cart
              </Link>
            ) : (
              <span className="shrink-0 rounded-xl bg-tint px-3 py-2 text-xs font-extrabold text-primary">
                {isScanning ? 'Ready' : 'Reading…'}
              </span>
            )}
          </div>
        )}

        {/* The camera is the fast path, not the only one. `BarcodeScanner` warns that a
            page served over plain HTTP gets no camera at all, and a shopper halfway round
            the shop cannot act on that — so when the camera fails, the number printed
            under every barcode still works. Entry codes are signed tokens, not short
            strings, so this is offered only for products. */}
        {cameraFault && active && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const code = manualCode.trim();
              if (!code) return;
              setManualCode('');
              setIsScanning(true);
              void handleScan(code);
            }}
            className="mb-3 rounded-2xl border border-border bg-surface p-4"
          >
            <label htmlFor="manual-barcode" className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
              Enter the barcode by hand
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="manual-barcode"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="8901725110016"
                className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-xs font-extrabold text-onPrimary disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              The digits printed beneath the bars. Any member of staff can also add items
              for you at the counter.
            </p>
          </form>
        )}

        {/* Requirement 3 asks for lookup duration to be visible during the pilot, so the
            ~2s target can be checked live rather than taken on trust. */}
        {lastTiming && <LookupTiming timing={lastTiming} />}
      </div>

      {lastScanned && (
        <ScanToast
          productName={lastScanned.name}
          priceLabel={`₹${(lastScanned.unit_price / 100).toFixed(2)}`}
          onDismiss={() => {
            setLastScanned(null);
            setIsScanning(true);
          }}
        />
      )}
    </div>
  );
}

function Brackets({ dimmed }: { dimmed: boolean }) {
  const arm = `absolute h-10 w-10 border-primary transition-opacity duration-200 ${
    dimmed ? 'opacity-25' : 'opacity-100'
  }`;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <span className={`${arm} left-6 top-6 rounded-tl-lg border-l-4 border-t-4`} />
      <span className={`${arm} right-6 top-6 rounded-tr-lg border-r-4 border-t-4`} />
      <span className={`${arm} bottom-6 left-6 rounded-bl-lg border-b-4 border-l-4`} />
      <span className={`${arm} bottom-6 right-6 rounded-br-lg border-b-4 border-r-4`} />
    </div>
  );
}

function LookupTiming({ timing }: { timing: LookupResult }) {
  const withinTarget = timing.totalMs <= 2000;

  return (
    <div className="mt-2.5 flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-2.5">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Last lookup</p>
      <div className="flex items-center gap-2">
        {timing.source === 'cache' && (
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-primary">
            Cached
          </span>
        )}
        <span className={`text-sm font-extrabold ${withinTarget ? 'text-ink' : 'text-danger'}`}>
          {timing.totalMs.toFixed(0)} ms
        </span>
      </div>
    </div>
  );
}
