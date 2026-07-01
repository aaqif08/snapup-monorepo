'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

const DISCOUNT_RATE = 0.05; // 5% — keep in sync with server-side calculation when wired to a real backend.

export default function DiscountBanner() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const totalPrice = useCartStore((state) => state.totalPrice); // paise
  const [isDismissed, setIsDismissed] = useState(false);

  // Never shown to already-authenticated users, and respects a same-session dismiss.
  if (isAuthenticated || isDismissed) return null;

  const discountRupees = (totalPrice * DISCOUNT_RATE) / 100;

  // Don't show the banner for an empty/zero cart — there's nothing to discount yet.
  if (discountRupees <= 0) return null;

  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl bg-primary/10 p-4 sm:mx-0">
      <span className="text-xl">🎉</span>
      <div className="flex-1">
        <p className="text-sm font-extrabold text-ink">
          Login &amp; save 5% — ₹{discountRupees.toFixed(2)} off this order
        </p>
        <button
          onClick={() => router.push('/login?redirect=/checkout')}
          className="mt-1.5 text-sm font-extrabold text-primary underline"
        >
          Login &amp; Save
        </button>
      </div>
      <button
        onClick={() => setIsDismissed(true)}
        aria-label="Dismiss discount offer"
        className="text-muted hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
