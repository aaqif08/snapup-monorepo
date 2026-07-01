'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import UndoToast from '@/components/UndoToast';
import { useCartStore, type CartItem } from '@/store/useCartStore';

interface PendingRemoval {
  item: CartItem;
  index: number;
}

export default function CartPage() {
  const router = useRouter();
  const { items, totalPrice, removeProduct, updateQuantity, restoreItem } = useCartStore();
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const itemTotal = totalPrice / 100;
  const platformFee = items.length > 0 ? 2.0 : 0.0;
  const totalBill = itemTotal + platformFee;

  const handleRemove = (item: CartItem, index: number) => {
    removeProduct(item.id);
    setPendingRemoval({ item, index });
  };

  const handleUndo = () => {
    if (!pendingRemoval) return;
    restoreItem(pendingRemoval.item, pendingRemoval.index);
    setPendingRemoval(null);
  };

  const handleToastExpire = () => setPendingRemoval(null);

  if (items.length === 0) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center bg-bg p-8 text-center">
        <p className="mb-4 text-5xl">🛒</p>
        <p className="mb-2 text-lg font-extrabold text-ink">Your cart is empty</p>
        <p className="max-w-xs text-sm leading-relaxed text-muted">
          Walk the aisles and scan item barcodes to build your cart here.
        </p>
        {pendingRemoval && (
          <UndoToast
            itemName={pendingRemoval.item.name}
            onUndo={handleUndo}
            onExpire={handleToastExpire}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-2xl flex-col bg-bg px-4 pt-4 sm:px-6">
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
        <span className="text-2xl">🏪</span>
        <div>
          <p className="text-sm font-extrabold text-ink">Shopping at DMart Supercenter</p>
          <p className="text-xs text-muted">HSR Layout, Sector 6</p>
        </div>
      </div>

      <h2 className="mb-3 ml-1 text-xs font-extrabold uppercase tracking-wide text-muted">Scanned Items</h2>
      <div className="mb-6 rounded-2xl border border-border bg-surface px-4">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`flex items-center justify-between gap-4 py-3.5 ${
              index !== items.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <div className="flex-1">
              <p className="font-bold text-ink">{item.name}</p>
              <p className="mt-1 text-xs text-muted">
                Weight: {item.expected_weight_grams}g · Qty: {item.quantity}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-sm font-bold text-ink"
                aria-label={`Decrease quantity of ${item.name}`}
              >
                −
              </button>
              <span className="w-4 text-center text-sm font-bold text-ink">{item.quantity}</span>
              <button
                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-sm font-bold text-ink"
                aria-label={`Increase quantity of ${item.name}`}
              >
                +
              </button>
            </div>
            <p className="w-20 text-right font-extrabold text-ink">
              ₹{((item.unit_price * item.quantity) / 100).toFixed(2)}
            </p>
            {/* Always-visible remove control, per spec — not hover-only or gesture-hidden. */}
            <button
              onClick={() => handleRemove(item, index)}
              className="rounded-lg px-2 py-1.5 text-xs font-bold text-red-500 transition hover:bg-red-50"
              aria-label={`Remove ${item.name}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <h2 className="mb-3 ml-1 text-xs font-extrabold uppercase tracking-wide text-muted">Bill Summary</h2>
      <div className="mb-8 rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 flex justify-between">
          <span className="text-sm font-medium text-muted">Item Total</span>
          <span className="text-sm font-semibold text-ink">₹{itemTotal.toFixed(2)}</span>
        </div>
        <div className="mb-2 flex justify-between">
          <span className="text-sm font-medium text-muted">Platform Fee</span>
          <span className="text-sm font-semibold text-ink">₹{platformFee.toFixed(2)}</span>
        </div>
        <div className="my-2.5 h-px bg-border" />
        <div className="flex justify-between">
          <span className="font-extrabold text-ink">Grand Total</span>
          <span className="text-lg font-extrabold text-ink">₹{totalBill.toFixed(2)}</span>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between border-t border-border bg-surface px-6 py-5 sm:-mx-6">
        <div>
          <p className="text-xl font-extrabold text-ink">₹{totalBill.toFixed(2)}</p>
          <p className="text-xs font-extrabold text-primary">View Detailed Bill</p>
        </div>
        <button
          onClick={() => router.push('/checkout')}
          className="rounded-2xl bg-primary px-6 py-3.5 text-sm font-extrabold text-white transition hover:opacity-90"
        >
          Proceed to Pay
        </button>
      </div>

      {pendingRemoval && (
        <UndoToast itemName={pendingRemoval.item.name} onUndo={handleUndo} onExpire={handleToastExpire} />
      )}
    </div>
  );
}
