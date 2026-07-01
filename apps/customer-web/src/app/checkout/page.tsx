'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DiscountBanner from '@/components/DiscountBanner';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { attemptUpiRedirect, buildUpiLink, isLikelyMobileDevice } from '@/lib/upi';

const PAYMENT_ROWS = [
  { label: 'BHIM UPI', bg: 'bg-[#E8F5E9]', icon: '🟩', app: 'bhim' as const },
  { label: 'GPay UPI', bg: 'bg-[#E3F2FD]', icon: '🟦', app: 'gpay' as const },
];

const UPI_GRID: Array<{ label: string; app: 'gpay' | 'phonepe' | 'paytm' | 'bhim' }> = [
  { label: 'GPay', app: 'gpay' },
  { label: 'PhonePe', app: 'phonepe' },
  { label: 'Paytm', app: 'paytm' },
  { label: 'BHIM', app: 'bhim' },
];

const DISCOUNT_RATE = 0.05; // 5% login discount — keep in sync with DiscountBanner.tsx.

export default function CheckoutPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { items, totalPrice, totalExpectedWeight, checkoutToken, generateCheckoutToken, clearCart } =
    useCartStore();

  const [pendingUpiQr, setPendingUpiQr] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState<string | null>(null); // which app label, for the "Opening GPay…" state

  const itemTotal = totalPrice / 100;
  const platformFee = items.length > 0 ? 2.0 : 0.0;
  // Per spec FR-3: discount applies to the item subtotal only, not the platform fee,
  // and only when authenticated. In production this is recalculated server-side at
  // order creation — this client figure is for display only, never the charged source of truth.
  const discountAmount = isAuthenticated ? itemTotal * DISCOUNT_RATE : 0;
  const totalBill = itemTotal + platformFee - discountAmount;

  // Guest checkout is now fully supported end-to-end (per the latest product
  // decision) — the only redirect left here is for an empty cart, never for
  // being unauthenticated. Login is offered via DiscountBanner, not enforced.
  useEffect(() => {
    if (items.length === 0) {
      router.replace('/cart');
    }
  }, [items.length, router]);

  if (items.length === 0) {
    return null;
  }

  /**
   * Real UPI app deep-link, per the NPCI UPI Linking Specification. On a
   * phone with the app installed, this actually opens GPay/PhonePe/etc.'s
   * payment confirmation screen with the amount pre-filled — this is the
   * same mechanism real Indian e-commerce checkouts use, not a simulation.
   *
   * IMPORTANT: `pa` (merchant VPA) in src/lib/upi.ts is a placeholder. This
   * opens the real app UI, but no money moves until that placeholder is
   * replaced with a real merchant VPA from a payment aggregator/PSP.
   *
   * generateCheckoutToken() still fires immediately — in production this
   * should instead wait for a real payment-confirmation webhook from your
   * PSP before marking the order paid; this demo doesn't have a backend to
   * receive that webhook, so it proceeds straight to the QR-token screen.
   */
  const handleUpiAppPayment = (app: 'gpay' | 'phonepe' | 'paytm' | 'bhim', label: string) => {
    const transactionRef = `snapup_${Date.now()}`;

    if (!isLikelyMobileDevice()) {
      // Desktop has no UPI app to catch the intent — show a QR code of the
      // same upi://pay link instead, same as real UPI checkouts do on web.
      setPendingUpiQr(buildUpiLink({ amountRupees: totalBill, transactionRef }));
      return;
    }

    setIsRedirecting(label);
    attemptUpiRedirect(app, { amountRupees: totalBill, transactionRef }, () => {
      // Neither the app-specific nor generic link seemed to open anything —
      // most likely that app isn't installed. Fall back to showing the QR.
      setIsRedirecting(null);
      setPendingUpiQr(buildUpiLink({ amountRupees: totalBill, transactionRef }));
    });
  };

  const handleGenericPaymentSelection = () => {
    // In production this calls POST /kiosk/sessions/:id/complete server-side,
    // which computes the real price/weight/discount and returns the signed QR
    // token — never trust the client-generated totalPrice for an actual charge.
    generateCheckoutToken();
  };

  const handleReset = () => {
    clearCart();
    router.push('/cart');
  };

  if (checkoutToken) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center bg-[#FAF7F2] p-6 text-center">
        <h1 className="mb-2 text-2xl font-extrabold text-primary">Payment Verified</h1>
        <p className="mb-10 max-w-sm text-sm leading-relaxed text-muted">
          Scan this QR code at the physical exit terminal to verify your basket weight and leave the store.
        </p>
        <div className="mb-5 rounded-3xl bg-white p-5 shadow-lg">
          <QRCodeSVG value={checkoutToken} size={220} />
        </div>
        <p className="mb-2 text-base font-bold text-ink">Expected Weight: {totalExpectedWeight}g</p>
        {discountAmount > 0 && (
          <p className="mb-10 text-sm font-bold text-primary">
            You saved ₹{discountAmount.toFixed(2)} by logging in 🎉
          </p>
        )}
        {discountAmount === 0 && <div className="mb-8" />}
        <button
          onClick={handleReset}
          className="rounded-xl bg-red-100 px-6 py-3 text-sm font-extrabold text-red-500"
        >
          Close &amp; Start New Cart
        </button>
      </div>
    );
  }

  // Desktop (or "app not installed") fallback: show the same upi://pay link
  // as a scannable QR code, since there's no app on this device to catch it.
  if (pendingUpiQr) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center bg-[#FAF7F2] p-6 text-center">
        <h1 className="mb-2 text-2xl font-extrabold text-ink">Scan to Pay</h1>
        <p className="mb-8 max-w-sm text-sm leading-relaxed text-muted">
          Open any UPI app on your phone and scan this code to complete the ₹{totalBill.toFixed(2)} payment.
        </p>
        <div className="mb-6 rounded-3xl bg-white p-5 shadow-lg">
          <QRCodeSVG value={pendingUpiQr} size={220} />
        </div>
        <button
          onClick={handleGenericPaymentSelection}
          className="mb-3 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-white hover:opacity-90"
        >
          I&apos;ve Completed the Payment
        </button>
        <button onClick={() => setPendingUpiQr(null)} className="text-sm font-bold text-muted">
          Back to payment options
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-[calc(100vh-64px)] max-w-2xl bg-bg pb-10">
      <DiscountBanner />

      <div className="sticky top-16 z-10 mt-4 flex items-center justify-between bg-surface px-5 py-4 shadow-sm">
        <span className="text-sm font-semibold text-ink">
          To Pay: <span className="font-extrabold text-primary">₹{totalBill.toFixed(2)}</span>
          {discountAmount > 0 && (
            <span className="ml-2 text-xs font-bold text-primary">
              (−₹{discountAmount.toFixed(2)} discount applied)
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-red-500">View Bill</span>
      </div>

      {isRedirecting && (
        <div className="mx-5 mt-4 rounded-xl bg-ink/90 px-4 py-3 text-center text-sm font-bold text-white">
          Opening {isRedirecting}…
        </div>
      )}

      <div className="px-5 pt-5">
        <h2 className="mb-3 ml-1 text-sm font-extrabold text-ink">Recommended Payments</h2>
        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface">
          {PAYMENT_ROWS.map((row, i) => (
            <button
              key={row.label}
              onClick={() => handleUpiAppPayment(row.app, row.label)}
              className={`flex w-full items-center gap-4 p-4 text-left ${
                i !== PAYMENT_ROWS.length - 1 ? 'border-b border-[#F0F0F0]' : ''
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${row.bg}`}>
                {row.icon}
              </span>
              <span className="flex-1 font-bold text-ink">{row.label}</span>
              <span className="text-muted">›</span>
            </button>
          ))}
        </div>

        <h2 className="mb-3 ml-1 text-sm font-extrabold text-ink">Pay by UPI</h2>
        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface">
          {/* Generic "any UPI app" link — per NPCI mandate this must use the
              generic upi://pay form (no app-specific scheme), shown on every
              merchant checkout regardless of which specific apps are listed above. */}
          <button
            onClick={() => handleUpiAppPayment('bhim', 'your UPI app')}
            className="flex w-full items-center gap-4 p-4 text-left"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F4F6]">🏛️</span>
            <div className="flex-1">
              <p className="font-bold text-ink">Pay by any UPI app</p>
              <p className="text-xs text-muted">Use any UPI app on your phone to pay</p>
            </div>
            <span className="text-muted">›</span>
          </button>

          <div className="grid grid-cols-4 gap-3 p-4">
            {UPI_GRID.map((item) => (
              <button
                key={item.label}
                onClick={() => handleUpiAppPayment(item.app, item.label)}
                className="flex flex-col items-center gap-2"
              >
                <span className="h-11 w-11 rounded-xl bg-[#F3F4F6]" />
                <span className="text-[11px] font-medium text-ink">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <h2 className="mb-3 ml-1 text-sm font-extrabold text-ink">In-Store</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <button
            onClick={handleGenericPaymentSelection}
            className="flex w-full items-center gap-4 p-4 text-left"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFEBEE]">💵</span>
            <div className="flex-1">
              <p className="font-bold text-ink">Pay through cash in kiosk or the counter</p>
              <p className="text-xs text-muted">Pay using physical cash or card at the exit</p>
            </div>
            <span className="h-5 w-5 rounded-full border-2 border-border" />
          </button>
        </div>
      </div>
    </div>
  );
}
