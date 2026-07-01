'use client';

import { useRouter } from 'next/navigation';
import { use } from 'react';
import { MOCK_RECOMMENDED_STORES, MOCK_STORES } from '@/lib/mockData';

export default function StoreConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const store = [...MOCK_STORES, ...MOCK_RECOMMENDED_STORES].find((s) => s.id === id);

  if (!store) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-lg font-extrabold text-ink">Store not found</p>
        <p className="mt-2 text-sm text-muted">This store may no longer be available.</p>
      </div>
    );
  }

  const handleConfirm = () => {
    // In production: POST /carts/guest (or attach to the authenticated user's cart)
    // scoped to store.id, then route into the scanner.
    router.push('/scan');
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
      <div className="mb-8 flex justify-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-primary/15">
          <span className="text-5xl">🏪</span>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-7 text-center">
        <h1 className="mb-2 text-xl font-extrabold text-ink">Confirm Store</h1>
        <p className="mb-6 text-sm leading-relaxed text-muted">
          We&apos;ll sync with this store&apos;s inventory and checkout kiosks for your session.
        </p>

        <div className="mb-6 rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-primary">
            Selected Store
          </p>
          <p className="mb-1 text-lg font-extrabold text-ink">{store.name}</p>
          <p className="text-sm text-muted">{store.address}</p>
        </div>

        <button
          onClick={handleConfirm}
          className="mb-3 w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-white transition hover:opacity-90"
        >
          Confirm &amp; Start Scanning
        </button>
        <button
          onClick={() => router.push('/')}
          className="w-full py-3 text-sm font-bold text-muted transition hover:text-ink"
        >
          Choose a different store
        </button>
      </div>
    </div>
  );
}
