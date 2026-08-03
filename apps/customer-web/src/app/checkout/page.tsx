'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DiscountBanner from '@/components/DiscountBanner';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { confirmPayment, createOrder, GatewayError, type ServerOrder } from '@/lib/api';
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

/**
 * Checkout.
 *
 * The figures shown before an order exists are an estimate computed from the cart for
 * responsiveness, and they are labelled as such. The moment the customer chooses how to
 * pay, the basket goes to the server, which re-prices it from the store's own catalogue
 * and returns the total that will actually be charged, the shop's UPI address to pay it
 * to, and — after payment — a signed exit token.
 *
 * Nothing on this screen computes money that anyone is charged. That used to be exactly
 * what it did: the cart total drove both the UPI link amount and a self-minted exit token,
 * all of it editable in devtools.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { items, totalPrice, clearCart } = useCartStore();

  const [order, setOrder] = useState<ServerOrder | null>(null);
  const [discountReason, setDiscountReason] = useState<string | null>(null);
  const [exit, setExit] = useState<{ token: string; verified: boolean } | null>(null);
  const [pendingUpiQr, setPendingUpiQr] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimatedItemTotal = totalPrice / 100;

  useEffect(() => {
    if (items.length === 0 && !exit) {
      router.replace('/cart');
    }
  }, [items.length, exit, router]);

  if (items.length === 0 && !exit) {
    return null;
  }

  /** Prices the basket server-side. Idempotent from the UI's point of view: one per attempt. */
  const ensureOrder = async (): Promise<ServerOrder | null> => {
    if (order) return order;

    setIsBusy(true);
    setError(null);
    try {
      const created = await createOrder(
        items.map((item) => ({ productId: item.id, quantity: item.quantity })),
        isAuthenticated
      );
      setOrder(created.order);
      setDiscountReason(created.discountReason);
      return created.order;
    } catch (createError) {
      setError(
        createError instanceof GatewayError
          ? createError.message
          : 'Could not prepare your order. Please try again.'
      );
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpiAppPayment = async (
    app: 'gpay' | 'phonepe' | 'paytm' | 'bhim',
    label: string
  ) => {
    const priced = await ensureOrder();
    if (!priced) return;

    // No VPA registered for this store means there is no account to send money to. Better
    // to say so than to open a UPI app pre-filled with a payee that does not exist.
    if (!priced.payment.payee_vpa) {
      setError(
        'This store has not set up in-app UPI payments yet. Please pay by cash or card at the counter.'
      );
      return;
    }

    const upiParams = {
      payeeVpa: priced.payment.payee_vpa,
      payeeName: priced.payment.payee_name ?? 'Store',
      amountRupees: priced.total / 100,
      transactionRef: priced.payment.transaction_ref,
    };

    if (!isLikelyMobileDevice()) {
      // Desktop has no UPI app to catch the intent — show a QR of the same link instead.
      setPendingUpiQr(buildUpiLink(upiParams));
      return;
    }

    setIsRedirecting(label);
    attemptUpiRedirect(app, upiParams, () => {
      setIsRedirecting(null);
      setPendingUpiQr(buildUpiLink(upiParams));
    });
  };

  const handlePaymentConfirmation = async (method: 'upi_attested' | 'in_store') => {
    const priced = await ensureOrder();
    if (!priced) return;

    setIsBusy(true);
    setError(null);
    try {
      const result = await confirmPayment(priced.id, method);
      setOrder(result.order);
      setExit({ token: result.exitToken, verified: result.paymentVerified });
      setPendingUpiQr(null);
    } catch (confirmError) {
      setError(
        confirmError instanceof GatewayError
          ? confirmError.message
          : 'Could not record your payment. Please ask a member of staff.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleReset = () => {
    clearCart();
    setOrder(null);
    setExit(null);
    router.push('/cart');
  };

  // ---- Exit screen ----
  if (exit && order) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center bg-[#FAF7F2] p-6 text-center">
        <h1 className="mb-2 text-2xl font-extrabold text-primary">
          {exit.verified ? 'Payment Recorded' : 'Almost Done'}
        </h1>
        <p className="mb-8 max-w-sm text-sm leading-relaxed text-muted">
          {exit.verified
            ? 'Scan this code at the exit terminal to verify your basket weight and leave the store.'
            : // Said plainly, because it is true: a tap on "I've paid" is not proof of
              // payment when the money went straight to the shop's own account and no
              // provider confirmed it. Setting the expectation here prevents an argument
              // at the gate.
              'Show this code at the exit. A member of staff will confirm your payment against the store’s own records before you leave.'}
        </p>
        <div className="mb-5 rounded-3xl bg-white p-5 shadow-lg">
          <QRCodeSVG value={exit.token} size={220} />
        </div>
        <p className="mb-1 text-base font-bold text-ink">
          Expected Weight: {order.expected_weight_grams}g
        </p>
        <p className="mb-8 text-sm font-bold text-muted">
          Paid: ₹{(order.total / 100).toFixed(2)}
        </p>
        <button
          onClick={handleReset}
          className="rounded-xl bg-red-100 px-6 py-3 text-sm font-extrabold text-red-500"
        >
          Close &amp; Start New Cart
        </button>
      </div>
    );
  }

  // ---- Desktop / app-not-installed QR fallback ----
  if (pendingUpiQr && order) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center bg-[#FAF7F2] p-6 text-center">
        <h1 className="mb-2 text-2xl font-extrabold text-ink">Scan to Pay</h1>
        <p className="mb-2 max-w-sm text-sm leading-relaxed text-muted">
          Open any UPI app on your phone and scan this code to pay ₹{(order.total / 100).toFixed(2)}{' '}
          to {order.payment.payee_name}.
        </p>
        <p className="mb-8 text-xs text-muted">Ref {order.payment.transaction_ref}</p>
        <div className="mb-6 rounded-3xl bg-white p-5 shadow-lg">
          <QRCodeSVG value={pendingUpiQr} size={220} />
        </div>
        {error && <p className="mb-3 max-w-sm text-xs font-bold text-red-500">{error}</p>}
        <button
          onClick={() => void handlePaymentConfirmation('upi_attested')}
          disabled={isBusy}
          className="mb-3 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isBusy ? 'Recording…' : "I've Completed the Payment"}
        </button>
        <button onClick={() => setPendingUpiQr(null)} className="text-sm font-bold text-muted">
          Back to payment options
        </button>
      </div>
    );
  }

  // ---- Payment method selection ----
  const displayTotal = order ? order.total / 100 : estimatedItemTotal;

  return (
    <div className="mx-auto min-h-[calc(100vh-64px)] max-w-2xl bg-bg pb-10">
      <DiscountBanner />

      <div className="sticky top-16 z-10 mt-4 flex items-center justify-between bg-surface px-5 py-4 shadow-sm">
        <span className="text-sm font-semibold text-ink">
          To Pay: <span className="font-extrabold text-primary">₹{displayTotal.toFixed(2)}</span>
          {!order && <span className="ml-2 text-xs font-medium text-muted">(estimate)</span>}
          {order && order.discount > 0 && (
            <span className="ml-2 text-xs font-bold text-primary">
              (−₹{(order.discount / 100).toFixed(2)} discount)
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-red-500">View Bill</span>
      </div>

      {/* The server declines to apply a discount it cannot verify. Saying why beats a
          silently different total at the moment the customer is about to pay. */}
      {discountReason === 'identity_unverifiable' && (
        <div className="mx-5 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          The 5% member discount could not be applied — please sign in again before checkout so
          we can confirm your account.
        </div>
      )}

      {error && (
        <div className="mx-5 mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      {isRedirecting && (
        <div className="mx-5 mt-4 rounded-xl bg-ink/90 px-4 py-3 text-center text-sm font-bold text-white">
          Opening {isRedirecting}…
        </div>
      )}

      {isBusy && !isRedirecting && (
        <div className="mx-5 mt-4 rounded-xl bg-ink/90 px-4 py-3 text-center text-sm font-bold text-white">
          Confirming your basket…
        </div>
      )}

      <div className="px-5 pt-5">
        <h2 className="mb-3 ml-1 text-sm font-extrabold text-ink">Recommended Payments</h2>
        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface">
          {PAYMENT_ROWS.map((row, i) => (
            <button
              key={row.label}
              onClick={() => void handleUpiAppPayment(row.app, row.label)}
              disabled={isBusy}
              className={`flex w-full items-center gap-4 p-4 text-left disabled:opacity-50 ${
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
            onClick={() => void handleUpiAppPayment('bhim', 'your UPI app')}
            disabled={isBusy}
            className="flex w-full items-center gap-4 p-4 text-left disabled:opacity-50"
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
                onClick={() => void handleUpiAppPayment(item.app, item.label)}
                disabled={isBusy}
                className="flex flex-col items-center gap-2 disabled:opacity-50"
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
            onClick={() => void handlePaymentConfirmation('in_store')}
            disabled={isBusy}
            className="flex w-full items-center gap-4 p-4 text-left disabled:opacity-50"
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
