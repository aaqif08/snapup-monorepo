'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ScanToast from '@/components/ScanToast';
import { useCartStore, type Product } from '@/store/useCartStore';
import { lookupProductByBarcode } from '@/lib/mockData';

export default function ScanPage() {
  const [isScanning, setIsScanning] = useState(true);
  const [lastScanned, setLastScanned] = useState<Product | null>(null);
  const [counterPulse, setCounterPulse] = useState(false);

  const addProduct = useCartStore((state) => state.addProduct);
  const cartItems = useCartStore((state) => state.items);
  const itemCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

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
    (barcode: string) => {
      if (!isScanning) return;
      setIsScanning(false);

      const product = lookupProductByBarcode(barcode);
      // Small delay before the rest (cart add + toast) so the scanner's own
      // detect-flash/checkmark animation gets a beat to play before the UI
      // shifts underneath it.
      setTimeout(() => {
        addProduct(product);
        setLastScanned(product);
      }, 180);
    },
    [isScanning, addProduct]
  );

  const handleContinue = () => {
    setLastScanned(null);
    setIsScanning(true);
  };

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
        <p className="mb-7 text-base leading-relaxed text-muted">
          Align any barcode within the frame above to automatically add it to your cart.
        </p>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-5">
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
      </div>
    </div>
  );
}
