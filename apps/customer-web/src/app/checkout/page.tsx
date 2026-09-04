'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CheckoutStepper from '@/components/CheckoutStepper';
import ScreenHeader from '@/components/ScreenHeader';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useSessionStore } from '@/store/useSessionStore';
import { confirmPayment, createOrder, GatewayError, type ServerOrder } from '@/lib/api';
import { attemptUpiRedirect, buildUpiLink, isLikelyMobileDevice } from '@/lib/upi';

type UpiApp = 'gpay' | 'phonepe' | 'paytm' | 'bhim';

/**
 * Checkout.
 *
 * Nothing on this screen computes money that anyone is charged. The basket goes to the
 * server, which re-prices it from the store's own catalogue and returns the total, the
 * shop's UPI address, and the code the customer shows at the exit. That used to be the
 * other way round — the cart total drove both the UPI amount and a self-minted exit
 * token, all of it editable in devtools.
 *
 * The screen has three states, and the middle one is the important one:
 *
 *   1. **choose** — pick how to pay
 *   2. **pay** — the UPI hand-off, then "I've paid"
 *   3. **done** — the exit code, and an honest account of what it is worth
 *
 * Under the direct-to-merchant model no provider tells SnapUp anything, so tapping
 * "I've paid" produces a *claim*. The done screen says so and shows the code staff will
 * check, rather than a green tick that would be a lie.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { items, totalPrice, clearCart } = useCartStore();

  const [order, setOrder] = useState<ServerOrder | null>(null);
  const [settled, setSettled] = useState<{
    token: string | null;
    verified: boolean;
    code: string | null;
    /** Which method was used, so the receipt names it rather than guessing. */
    method: string;
  } | null>(null);
  const storeName = useSessionStore((state) => state.storeName);
  const setLocked = useCartStore((state) => state.setLocked);
  const [pendingUpiQr, setPendingUpiQr] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    useCartStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (items.length === 0 && !settled) router.replace('/cart');
  }, [items.length, settled, router]);

  if (items.length === 0 && !settled) return null;

  /** Prices the basket server-side. One order per attempt; reused once it exists. */
  async function ensureOrder(): Promise<ServerOrder | null> {
    // Frozen while the server prices it. The server prices what it was sent, so an item
    // scanned between the request and the response is an item in the trolley and not on
    // the bill.
    setLocked(true);
    if (order) return order;

    setBusy(true);
    setError(null);
    try {
      const created = await createOrder(
        items.map((item) => ({ productId: item.id, quantity: item.quantity })),
        isAuthenticated
      );
      setOrder(created.order);
      return created.order;
    } catch (exc) {
      setError(
        exc instanceof GatewayError ? exc.message : 'Could not prepare your order. Please try again.'
      );
      return null;
    } finally {
      setBusy(false);
      // Released whichever way it went. A basket left frozen by a failed pricing call is
      // a customer who cannot add anything and has no idea why.
      setLocked(false);
    }
  }

  async function payWithUpi(app: UpiApp, label: string) {
    const priced = await ensureOrder();
    if (!priced) return;

    // No VPA registered means there is no account to send money to. Better to say so than
    // to open a UPI app pre-filled with a payee that does not exist.
    if (!priced.payment.payee_vpa) {
      setError(
        'This store has not set up in-app UPI payments yet. Please pay by cash or card at the counter.'
      );
      return;
    }

    const params = {
      payeeVpa: priced.payment.payee_vpa,
      payeeName: priced.payment.payee_name ?? 'Store',
      amountRupees: priced.total / 100,
      transactionRef: priced.payment.transaction_ref,
    };

    // Desktop has no UPI app to catch the intent, so show a QR of the same link instead.
    if (!isLikelyMobileDevice()) {
      setPendingUpiQr(buildUpiLink(params));
      return;
    }

    setRedirecting(label);
    attemptUpiRedirect(app, params, () => {
      setRedirecting(null);
      setPendingUpiQr(buildUpiLink(params));
    });
  }

  async function confirm(method: 'upi_attested' | 'in_store') {
    // §3: no second attempt while the first result is unknown. `busy` already disables
    // the buttons, but a double tap can land two calls before React re-renders, and the
    // second would be a second payment against the same basket.
    if (busy || settled) return;
    const priced = await ensureOrder();
    if (!priced) return;

    setBusy(true);
    setError(null);
    try {
      const result = await confirmPayment(priced.id, method);
      setOrder(result.order);
      setSettled({
        token: result.exitToken,
        verified: result.paymentVerified,
        code: result.verificationCode,
        method,
      });
      setPendingUpiQr(null);
      clearCart();
    } catch (exc) {
      setError(
        exc instanceof GatewayError
          ? exc.message
          : 'Could not record your payment. Please ask a member of staff.'
      );
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- done ----
  if (settled && order) {
    return (
      <div className="mx-auto max-w-lg">
        <ScreenHeader title="" onBack={() => router.push('/')} />
        <CheckoutStepper current="pay" />

        <div className="px-4 pb-6 text-center">
          {/* The design's success mark. Shown only when the payment is actually confirmed —
              a green tick over an unverified basket would tell the customer the money
              arrived when nothing has checked, which is the one claim this screen must
              never make. Unverified gets the neutral mark and the exit code instead. */}
          <div
            className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full ${
              settled.verified ? 'bg-primary' : 'bg-tint'
            }`}
            aria-hidden
          >
            {settled.verified ? (
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-onPrimary" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-primary" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
          </div>

          <h1 className="text-2xl font-extrabold text-ink">
            {settled.verified ? 'Payment Successful' : 'Almost done'}
          </h1>

          <p className="mt-2 text-4xl font-extrabold tabular-nums text-ink">
            ₹{(order.total / 100).toFixed(2)}
          </p>

          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
            {settled.verified
              ? 'Your payment was completed successfully. Show this at the exit to verify your basket and leave.'
              : // True, and worth saying: a tap on "I've paid" is not proof when the money
                // went to the shop's own account and no provider confirmed it. Setting the
                // expectation here is what prevents an argument at the gate.
                'Show this code at the exit. A member of staff will check your payment against the shop’s own records before you leave.'}
          </p>

          {settled.code && !settled.verified && (
            <div className="mx-auto mt-6 w-full max-w-xs rounded-3xl border-2 border-dashed border-primary/50 bg-tint px-6 py-7">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                Show this code
              </p>
              <p className="mt-2 font-mono text-4xl font-extrabold tracking-[0.35em] text-ink">
                {settled.code}
              </p>
            </div>
          )}

          {settled.token && (
            // Stays white in both themes — a QR is dark modules on a light quiet zone, and
            // inverting it stops scanners reading it.
            <div className="mx-auto mt-6 inline-block rounded-3xl bg-white p-5 shadow-pop">
              <QRCodeSVG value={settled.token} size={200} />
            </div>
          )}

          <div className="mx-auto mt-6 w-full rounded-2xl border border-border bg-surface p-4 text-left">
            <Row label="Store" value={storeName ?? 'This shop'} />
            <Row label="Payment method" value={methodLabel(settled.method)} />
            <Row label="Transaction ID" value={order.payment.transaction_ref} mono />
            <Row label="Expected basket weight" value={`${order.expected_weight_grams} g`} />
            <Row label="Amount paid" value={`₹${(order.total / 100).toFixed(2)}`} strong />
          </div>

          <button
            onClick={() => router.push('/')}
            className="mt-5 w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition hover:opacity-90"
          >
            Back to Home →
          </button>
          <button
            onClick={() => router.push('/bills')}
            className="mt-3 w-full text-sm font-extrabold text-primary hover:underline"
          >
            View my bills
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- paying ----
  const total = order ? order.total : totalPrice;

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="" onBack={() => router.back()} />
      <CheckoutStepper current="pay" />

      <div className="px-4 pb-6">
        <div className="rounded-2xl bg-tint px-4 py-5 text-center">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
            {order ? 'Amount to pay' : 'Estimated total'}
          </p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums text-ink">
            ₹{(total / 100).toFixed(2)}
          </p>
          {!order && (
            <p className="mt-1 text-[11px] text-muted">
              The shop confirms the final price when you choose a method.
            </p>
          )}
        </div>

        {order && <PaymentSummary order={order} />}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
            {error}
          </p>
        )}

        {pendingUpiQr ? (
          <div className="mt-5 rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="text-sm font-extrabold text-ink">Scan with any UPI app</p>
            <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-muted">
              Pays {order?.payment.payee_name ?? 'the shop'} directly. Money never passes
              through SnapUp.
            </p>
            <div className="mx-auto mt-4 inline-block rounded-2xl bg-white p-4">
              <QRCodeSVG value={pendingUpiQr} size={180} />
            </div>
            <button
              onClick={() => setPendingUpiQr(null)}
              className="mt-4 text-xs font-extrabold text-muted underline underline-offset-2"
            >
              Choose a different method
            </button>
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
            <MethodRow
              icon={<UpiMark />}
              label="GPay, PhonePe & UPI"
              hint="Pays the shop directly"
              busy={redirecting === 'UPI'}
              disabled={busy}
              onClick={() => void payWithUpi('gpay', 'UPI')}
            />
            <MethodRow
              icon={<CardMark />}
              label="Credit / Debit card"
              hint="Pay at the counter"
              disabled={busy}
              onClick={() => void confirm('in_store')}
            />
            <MethodRow
              icon={<CashMark />}
              label="Other payment method"
              hint="Cash or anything else at the counter"
              disabled={busy}
              onClick={() => void confirm('in_store')}
              last
            />
          </div>
        )}

        {/* Only offered once a UPI hand-off has actually happened. Showing "I've paid"
            before the customer has been sent anywhere invites tapping it by mistake. */}
        {(pendingUpiQr || redirecting) && (
          <button
            onClick={() => void confirm('upi_attested')}
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Please wait…' : 'I’ve paid'}
          </button>
        )}

        <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted">
          Money goes straight to the shop’s own account. SnapUp never holds it, which is
          why a member of staff checks the payment at the exit.
        </p>
      </div>
    </div>
  );
}

function MethodRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  busy,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-bg disabled:opacity-50 ${
        last ? '' : 'border-b border-border'
      }`}
    >
      <span className="flex h-9 w-12 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>
      </span>
      <span className="shrink-0 text-muted">
        {busy ? (
          <span className="text-[11px] font-extrabold text-primary">Opening…</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 5l7 7-7 7" />
          </svg>
        )}
      </span>
    </button>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={`truncate text-sm ${strong ? 'font-extrabold text-ink' : 'font-semibold text-ink'} ${
          mono ? 'font-mono text-[11px]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function UpiMark() {
  return (
    <span className="flex h-7 w-11 items-center justify-center rounded-md bg-tint text-[10px] font-extrabold tracking-tight text-primary">
      UPI
    </span>
  );
}

function CardMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-9 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 9.5h20" />
    </svg>
  );
}

function CashMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-9 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/**
 * How the money was tendered, in the customer's words.
 *
 * `upi_attested` is deliberately not called "UPI — paid": the confirmation it produces is
 * the customer's own claim, and the heading beside this already distinguishes verified from
 * awaiting. Naming the method is not the place to relitigate that.
 */
function methodLabel(method: string): string {
  if (method === 'upi_attested') return 'UPI';
  if (method === 'in_store') return 'At the counter';
  return method;
}

/**
 * The payment summary.
 *
 * Every figure comes from the priced order the server returned — nothing here adds up a
 * total of its own. A summary that recomputes is a summary that can disagree with the
 * amount actually charged, and the first anyone would know of it is a customer at the exit
 * holding a bill that does not match their screen.
 *
 * The service fee is the whole of the membership offer: a guest pays a tenth of the item
 * total, and signing in strikes it through and prints FREE. So the fee line is always shown
 * — struck through rather than removed — because "you are not paying this" only lands if
 * the customer can see what they are not paying.
 */
function PaymentSummary({ order }: { order: ServerOrder }) {
  const waived = order.discount > 0;
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
        Payment summary
      </p>

      <dl className="mt-3 space-y-2.5 text-sm">
        <SummaryRow label="Item Total" value={rupees(order.subtotal)} />

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Service Fees</dt>
          <dd className="flex items-baseline gap-2 tabular-nums">
            <span className={waived ? 'text-muted line-through' : 'font-semibold text-ink'}>
              {rupees(order.service_fee)}
            </span>
            {waived && <span className="font-extrabold text-primary">FREE</span>}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Snap Up Discount</dt>
          <dd className="tabular-nums">
            {waived ? (
              <span className="font-semibold text-primary">−{rupees(order.discount)}</span>
            ) : (
              // The offer, stated where the money would be. A guest is not being told they
              // saved nothing; they are being told what signing in is worth on this basket.
              <span className="text-[13px] font-semibold text-primary">
                ₹0 — Login to redeem
              </span>
            )}
          </dd>
        </div>

        {/* Hidden entirely while the rate is zero. A tax line of ₹0.00 invites a question
            about why it is zero, and the honest answer — no HSN codes in the catalogue yet
            — does not belong on a customer's checkout. */}
        {order.gst > 0 && <SummaryRow label="GST & Other Charges" value={rupees(order.gst)} />}

        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
          <dt className="font-extrabold text-ink">Total to Pay</dt>
          <dd className="text-lg font-extrabold tabular-nums text-ink">
            {rupees(order.total)}
          </dd>
        </div>
      </dl>

      {order.product_savings > 0 && (
        <p className="mt-3 text-[12px] font-semibold text-primary">
          Shop offers already applied: you saved {rupees(order.product_savings)}.
        </p>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
