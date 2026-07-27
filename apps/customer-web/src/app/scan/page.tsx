'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BarcodeScanner from '@/components/BarcodeScanner';
import ScanToast from '@/components/ScanToast';
import SessionBanner from '@/components/SessionBanner';
import { useCartStore, type Product } from '@/store/useCartStore';
import { useSessionStore } from '@/store/useSessionStore';
import { lookupBarcode, sendHeartbeat, GatewayError, type LookupResult } from '@/lib/api';

/** How often to re-confirm presence. Trades server load against how quickly a departed
 *  customer sees the session end. Enforcement is per-request regardless — see session.ts. */
const HEARTBEAT_INTERVAL_MS = 20_000;

export default function ScanPage() {
  const router = useRouter();

  const [isScanning, setIsScanning] = useState(true);
  const [lastScanned, setLastScanned] = useState<Product | null>(null);
  const [lastTiming, setLastTiming] = useState<LookupResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [counterPulse, setCounterPulse] = useState(false);

  const addProduct = useCartStore((state) => state.addProduct);
  const cartItems = useCartStore((state) => state.items);
  const itemCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  const status = useSessionStore((state) => state.status);
  const storeName = useSessionStore((state) => state.storeName);

  // Rehydrate the persisted session before deciding whether to bounce the customer out,
  // otherwise the first client render always looks like "no session".
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    useSessionStore.persist.rehydrate();
    setHydrated(true);
  }, []);

  // No valid session means no database access, so there is nothing to scan for.
  useEffect(() => {
    if (hydrated && status !== 'active') {
      setIsScanning(false);
    }
  }, [hydrated, status]);

  // Continuous presence validation.
  useEffect(() => {
    if (!hydrated || status !== 'active') return;

    const timer = setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hydrated, status]);

  const prevCountRef = useRef(itemCount);
  useEffect(() => {
    if (itemCount > prevCountRef.current) {
      setCounterPulse(true);
      const timer = setTimeout(() => setCounterPulse(false), 320);
      prevCountRef.current = itemCount;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = itemCount;
  }, [itemCount]);

  const handleScan = useCallback(
    async (barcode: string) => {
      if (!isScanning) return;
      setIsScanning(false);
      setScanError(null);

      try {
        const result = await lookupBarcode(barcode);

        // Small delay before the cart add + toast so the scanner's own detect-flash gets
        // a beat to play before the UI shifts underneath it.
        setTimeout(() => {
          addProduct(result.product);
          setLastScanned(result.product);
          setLastTiming(result);
        }, 180);
      } catch (err) {
        if (err instanceof GatewayError && err.code === 'product_not_found') {
          setScanError('That item isn’t in this store’s catalogue.');
        } else if (err instanceof GatewayError && err.code === 'rate_limited') {
          setScanError('Slow down a moment — too many scans at once.');
        } else if (err instanceof GatewayError) {
          // Presence/expiry failures already tore the session down inside the api layer;
          // SessionBanner renders the explanation, so nothing more is needed here.
          setScanError(null);
        } else {
          setScanError('Couldn’t reach the store. Check your connection and try again.');
        }
        setIsScanning(true);
      }
    },
    [isScanning, addProduct]
  );

  const handleContinue = () => {
    setLastScanned(null);
    setIsScanning(true);
  };

  if (hydrated && status !== 'active') {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <SessionBanner status={status} onRestart={() => router.push('/enter')} />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[calc(100vh-64px)] flex-col bg-[#000]">
      {/* Camera viewport */}
      <div className="flex flex-1 items-center justify-center px-6 pb-72 pt-10">
        <div className="h-[280px] w-full max-w-sm">
          <BarcodeScanner isActive={isScanning} onScan={handleScan} />
        </div>
      </div>

      {lastScanned && (
        <ScanToast
          productName={lastScanned.name}
          priceLabel={`₹${(lastScanned.unit_price / 100).toFixed(2)}`}
          onDismiss={handleContinue}
        />
      )}

      {/* Bottom control surface, ported from the original controlSurface styles */}
      <div className="absolute inset-x-0 bottom-0 rounded-t-[32px] bg-bg px-6 pb-10 pt-4 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
        <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-border" />
        <h1 className="mb-2 text-2xl font-extrabold text-ink">Ready to Scan</h1>
        <p className="mb-4 text-base leading-relaxed text-muted">
          {storeName
            ? `Connected to ${storeName}. Align any barcode within the frame above.`
            : 'Align any barcode within the frame above to automatically add it to your cart.'}
        </p>

        {scanError && (
          <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
            {scanError}
          </p>
        )}

        <div className="mb-3 flex items-center justify-between rounded-2xl border border-border bg-surface p-5">
          <div>
            <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">Active Cart</p>
            <p
              className={`text-lg font-extrabold text-ink transition-transform ${
                counterPulse ? 'scale-125 text-primary' : 'scale-100'
              }`}
              style={{ transitionDuration: counterPulse ? '120ms' : '200ms' }}
            >
              {itemCount} Items Indexed
            </p>
          </div>
          <div className="rounded-xl bg-primary/15 px-3 py-2">
            <p className="text-sm font-extrabold text-primary">
              {isScanning ? 'Awaiting Scan' : 'Processing'}
            </p>
          </div>
        </div>

        {/* Requirement 3 asks for lookup duration to be visible during the POC so the
            ~2s target can be validated live rather than taken on trust. */}
        {lastTiming && <LookupTiming timing={lastTiming} />}
      </div>
    </div>
  );
}

function LookupTiming({ timing }: { timing: LookupResult }) {
  const withinTarget = timing.totalMs <= 2000;

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Last lookup</p>
      <div className="flex items-center gap-2">
        {timing.source === 'cache' && (
          <span className="rounded-md bg-primary/15 px-2 py-1 text-[10px] font-extrabold uppercase text-primary">
            Cached
          </span>
        )}
        <span className={`text-sm font-extrabold ${withinTarget ? 'text-ink' : 'text-danger'}`}>
          {timing.totalMs.toFixed(0)} ms
        </span>
        {timing.source === 'network' && (
          <span className="text-xs font-bold text-muted">(db {timing.serverLookupMs.toFixed(2)} ms)</span>
        )}
      </div>
    </div>
  );
}
