'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import ScreenHeader from '@/components/ScreenHeader';
import UndoToast from '@/components/UndoToast';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useSessionStore } from '@/store/useSessionStore';

interface PendingRemoval {
  item: CartItem;
  index: number;
}

/**
 * My Cart.
 *
 * The totals here are **display only**. What anyone pays is priced server-side from the
 * store's own catalogue when the order is created — these numbers exist so the screen
 * responds instantly to a tap on the stepper, and nothing downstream trusts them.
 *
 * That is why the discount line says "applied at checkout" rather than showing a figure.
 * The real discount depends on whether the shopper is signed in, and the server decides
 * that; a number here that the next screen contradicts is worse than no number at all.
 */
const SERVICE_FEE_RATE = 0.1;

export default function CartPage() {
  const router = useRouter();

  const [hydrated, setHydrated] = useState(false);
  const { items, totalPrice, removeProduct, updateQuantity, restoreItem } = useCartStore();
  const storeName = useSessionStore((state) => state.storeName);
  const hasSession = useSessionStore((state) => Boolean(state.token));

  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [showOffer, setShowOffer] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Zustand's persist hydrates asynchronously; rendering first would flash the empty
  // state at anyone returning to a full basket.
  useEffect(() => {
    useCartStore.persist.rehydrate();
    setHydrated(true);
  }, []);

  function remove(productId: string) {
    const index = items.findIndex((item) => item.id === productId);
    if (index < 0) return;
    setPendingRemoval({ item: items[index], index });
    removeProduct(productId);
  }

  const count = items.reduce((total, item) => total + item.quantity, 0);

  if (!hydrated) return <div className="min-h-[60vh] bg-bg" />;

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="My Cart" icon={<CartMark />} />

      {items.length === 0 ? (
        <EmptyCart hasSession={hasSession} />
      ) : (
        <div className="px-4 pb-4">
          {/* Which shop this basket belongs to. A cart carried between two shops is the
              one thing that would silently price everything wrong. */}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
              <PinIcon />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{storeName ?? 'Your shop'}</p>
              <p
                className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                  hasSession ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning'
                }`}
              >
                {hasSession ? 'Shopping in progress' : 'Session ended'}
              </p>
            </div>
          </div>

          <h2 className="px-1 pb-2 pt-5 text-sm font-extrabold text-ink">Your Items ({count})</h2>

          <ul className="space-y-2.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
              >
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg text-xl"
                  aria-hidden
                >
                  🛒
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">{item.barcode}</p>
                  <p className="mt-1 text-sm font-extrabold text-ink">
                    {rupees(item.unit_price * item.quantity)}
                  </p>
                </div>

                <Stepper
                  quantity={item.quantity}
                  label={item.name}
                  onDecrease={() =>
                    item.quantity <= 1
                      ? remove(item.id)
                      : updateQuantity(item.id, item.quantity - 1)
                  }
                  onIncrease={() => updateQuantity(item.id, item.quantity + 1)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
            <Row label="Subtotal" value={rupees(totalPrice)} />
            <Row label="Discount" value="Applied at checkout" muted />
            <div className="my-3 border-t border-dashed border-border" />
            <div className="flex items-baseline justify-between">
              <span className="text-base font-extrabold text-ink">Total Amount</span>
              <span className="text-lg font-extrabold text-ink">{rupees(totalPrice)}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              The shop confirms the final price when you check out.
            </p>
          </div>

          <button
            onClick={() => {
              // The offer is put in front of a guest once, here, because this is the last
              // moment it can change what they pay. Signed-in shoppers go straight
              // through — there is nothing to offer them.
              if (isAuthenticated) router.push('/checkout');
              else setShowOffer(true);
            }}
            disabled={!hasSession}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
          >
            Proceed to Pay <span aria-hidden>→</span> {rupees(totalPrice)}
          </button>

          {showOffer && (
            <DiscountOffer
              savingPaise={Math.round(totalPrice * SERVICE_FEE_RATE)}
              onIgnore={() => {
                // Continue at the guest total, exactly as the spec asks. Dismissing must
                // not cost the customer their basket or send them round the loop again.
                setShowOffer(false);
                router.push('/checkout');
              }}
              onLogin={() => {
                // Returns here rather than to the home screen. The cart is persisted, so
                // coming back finds the same basket — no new cart is created.
                router.push('/login?redirect=/checkout');
              }}
            />
          )}

          {!hasSession && (
            <p className="mt-2 text-center text-[12px] font-semibold text-warning">
              Your shopping session has ended. Scan the entrance code again to check out.
            </p>
          )}
        </div>
      )}

      {pendingRemoval && (
        <UndoToast
          itemName={pendingRemoval.item.name}
          onUndo={() => {
            restoreItem(pendingRemoval.item, pendingRemoval.index);
            setPendingRemoval(null);
          }}
          onExpire={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}

function EmptyCart({ hasSession }: { hasSession: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      <div
        className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-tint text-4xl"
        aria-hidden
      >
        🛒
      </div>
      <p className="mt-5 text-base font-extrabold text-ink">Your cart is empty</p>
      <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted">
        {hasSession
          ? 'Scan a barcode to add your first item.'
          : 'Scan the entrance code at a SnapUp shop to start.'}
      </p>
      <Link
        href="/scan"
        className="mt-6 inline-flex rounded-2xl bg-primary px-6 py-3 text-sm font-extrabold text-onPrimary"
      >
        Start scanning
      </Link>
    </div>
  );
}

function Stepper({
  quantity,
  onDecrease,
  onIncrease,
  label,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-tint p-1">
      <button
        onClick={onDecrease}
        aria-label={`Reduce quantity of ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/15"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M6 12h12" />
        </svg>
      </button>
      <span aria-live="polite" className="min-w-[1.25rem] text-center text-sm font-extrabold text-ink">
        {quantity}
      </span>
      <button
        onClick={onIncrease}
        aria-label={`Add another ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/15"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M12 6v12M6 12h12" />
        </svg>
      </button>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-semibold ${muted ? 'text-muted' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function CartMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.55L21 8H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

/** Paise to a displayed rupee amount. Display only — never used to compute anything. */
function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2).replace(/\.00$/, '')}`;
}

/**
 * The membership offer, shown once, on the way to payment.
 *
 * ## Why it interrupts at all
 *
 * This is the last moment the number can change. A guest who reaches the payment screen and
 * only then learns that signing in would have removed the fee has to go back, and going
 * back through a checkout is where baskets get abandoned.
 *
 * ## Why Ignore is a real choice
 *
 * The spec asks for it and it is right: somebody in a queue with a trolley does not want an
 * account, and making the offer refusable is what keeps it an offer. Ignoring continues at
 * the guest total and never asks again in this basket.
 *
 * Login returns to `/checkout`, not to the home screen. The cart is persisted, so the same
 * basket is waiting — no cart is created, nothing is rescanned.
 */
function DiscountOffer({
  savingPaise,
  onIgnore,
  onLogin,
}: {
  savingPaise: number;
  onIgnore: () => void;
  onLogin: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="offer-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-pop">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tint">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20.6 8.6L12 2 3.4 8.6 6.7 19h10.6z" />
            <path d="M9.5 14.5l5-5M9.6 9.6h.01M14.4 14.4h.01" />
          </svg>
        </div>

        <h2 id="offer-title" className="mt-4 text-xl font-extrabold text-ink">
          Save ₹{(savingPaise / 100).toFixed(2)} on this basket
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Snap Up members pay no service fee. Sign in and it comes straight off this bill —
          your basket stays exactly as it is.
        </p>

        <button
          onClick={onLogin}
          className="mt-6 w-full rounded-2xl bg-primary py-3.5 text-base font-extrabold text-onPrimary transition hover:opacity-90"
        >
          Login &amp; save ₹{(savingPaise / 100).toFixed(2)}
        </button>
        <button
          onClick={onIgnore}
          className="mt-3 w-full py-2 text-sm font-bold text-muted hover:underline"
        >
          Ignore and continue
        </button>
      </div>
    </div>
  );
}
