'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchNearbyStores, type NearbyStore } from '@/lib/api';

export default function StoreConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [store, setStore] = useState<NearbyStore | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Resolved from the directory API rather than a client-side constant, so a store the
  // admin added minutes ago is reachable here without a redeploy.
  useEffect(() => {
    let cancelled = false;

    fetchNearbyStores()
      .then((result) => {
        if (cancelled) return;
        setStore(result.stores.find((candidate) => candidate.id === id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setStore(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleConfirm = () => {
    // Routes to the SDPA entry gate rather than straight to the scanner: picking a store
    // from a list is a statement of intent, not proof of presence. The scanner is
    // unreachable until the entrance QR and the store network both check out.
    router.push('/enter');
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <div className="h-64 animate-pulse rounded-3xl border border-border bg-surface" />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-lg font-extrabold text-ink">Store not found</p>
        <p className="mt-2 text-sm text-muted">This store may no longer be available.</p>
        <button
          onClick={() => router.push('/')}
          className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-extrabold text-white"
        >
          Browse stores
        </button>
      </div>
    );
  }

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
          {store.distanceKm !== undefined && (
            <p className="mt-2 text-xs font-bold text-primary">
              {store.distanceKm.toFixed(1)} km from you
            </p>
          )}
        </div>

        {/* The customer has to be on this network for the next step to succeed, so name it
            here rather than letting them discover it as a failure at the entry gate. */}
        <div className="mb-6 rounded-2xl border border-border bg-bg p-4 text-left">
          <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">
            Before you scan
          </p>
          <p className="text-sm leading-relaxed text-ink">
            Connect to the <span className="font-extrabold">{store.ssid}</span> Wi-Fi inside the
            store. SnapUp verifies both the entrance code and the store network.
          </p>
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
