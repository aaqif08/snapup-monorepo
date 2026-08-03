import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Product {
  id: string;
  barcode: string;
  name: string;
  /** Stored in paise/cents to eliminate floating-point calculation issues */
  unit_price: number;
  expected_weight_grams: number;
}

export interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  items: CartItem[];
  totalPrice: number;
  totalExpectedWeight: number;
  guestSessionId: string;
  addProduct: (product: Product) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeProduct: (productId: string) => void;
  /** Re-inserts a previously removed item at its original index, preserving
   *  exact quantity — used by the cart's "Undo" toast. Distinct from
   *  addProduct, which always adds quantity 1 or increments an existing line. */
  restoreItem: (item: CartItem, atIndex: number) => void;
  clearCart: () => void;
}

/**
 * Display-only totals.
 *
 * These drive the cart and checkout UI so it responds instantly, but they are never what
 * anyone is charged: at checkout the basket is sent to `POST /api/orders` as product ids
 * and quantities, and the server re-prices it from the store's catalogue. The exit token
 * used to be minted here from these numbers, which made both the amount paid and the
 * expected basket weight editable from devtools; it is now issued and signed server-side.
 */
function recalcTotals(items: CartItem[]) {
  const totalPrice = items.reduce((acc, item) => acc + item.unit_price * item.quantity, 0);
  const totalExpectedWeight = items.reduce(
    (acc, item) => acc + item.expected_weight_grams * item.quantity,
    0
  );
  return { totalPrice, totalExpectedWeight };
}

function createGuestSessionId() {
  // crypto.randomUUID is available in all modern browsers (and Node 19+ for SSR safety).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `guest_${crypto.randomUUID()}`;
  }
  // Fallback for older environments — not cryptographically strong, only used as a
  // client-side correlation key, never as an auth credential.
  return `guest_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      totalPrice: 0,
      totalExpectedWeight: 0,
      guestSessionId: createGuestSessionId(),

      addProduct: (product) => {
        set((state) => {
          const existingIndex = state.items.findIndex((item) => item.id === product.id);
          const updatedItems = [...state.items];

          if (existingIndex >= 0) {
            updatedItems[existingIndex] = {
              ...updatedItems[existingIndex],
              quantity: updatedItems[existingIndex].quantity + 1,
            };
          } else {
            updatedItems.push({ ...product, quantity: 1 });
          }

          const { totalPrice, totalExpectedWeight } = recalcTotals(updatedItems);
          return { items: updatedItems, totalPrice, totalExpectedWeight };
        });
      },

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeProduct(productId);
          return;
        }

        set((state) => {
          const updatedItems = state.items.map((item) =>
            item.id === productId ? { ...item, quantity } : item
          );
          const { totalPrice, totalExpectedWeight } = recalcTotals(updatedItems);
          return { items: updatedItems, totalPrice, totalExpectedWeight };
        });
      },

      // FIX from the original useCartStore.ts: the previous version returned
      // `{ updatedItems, ... }` instead of `{ items: updatedItems, ... }`, so the
      // `items` key in state was never actually updated and removal silently failed.
      removeProduct: (productId) => {
        set((state) => {
          const updatedItems = state.items.filter((item) => item.id !== productId);
          const { totalPrice, totalExpectedWeight } = recalcTotals(updatedItems);
          return { items: updatedItems, totalPrice, totalExpectedWeight };
        });
      },

      restoreItem: (item, atIndex) => {
        set((state) => {
          // Guard against double-restore (e.g. a stale Undo toast tapped twice).
          if (state.items.some((existing) => existing.id === item.id)) {
            return state;
          }
          const updatedItems = [...state.items];
          const insertAt = Math.min(Math.max(atIndex, 0), updatedItems.length);
          updatedItems.splice(insertAt, 0, item);
          const { totalPrice, totalExpectedWeight } = recalcTotals(updatedItems);
          return { items: updatedItems, totalPrice, totalExpectedWeight };
        });
      },

      clearCart: () => set({ items: [], totalPrice: 0, totalExpectedWeight: 0 }),
    }),
    {
      name: 'snapup-cart-storage',
      // Avoid attempting to touch localStorage during SSR.
      skipHydration: typeof window === 'undefined',
    }
  )
);
