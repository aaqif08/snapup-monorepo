'use client';

import { useMemo, useState } from 'react';
import StoreCard from '@/components/StoreCard';
import { MOCK_STORES, MOCK_RECOMMENDED_STORES } from '@/lib/mockData';

export default function HomeContent() {
  const [locationLabel, setLocationLabel] = useState('HSR Layout, Bangalore');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredNearby = useMemo(() => {
    if (!searchQuery.trim()) return MOCK_STORES;
    const q = searchQuery.toLowerCase();
    return MOCK_STORES.filter(
      (store) => store.name.toLowerCase().includes(q) || store.address.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // Manual fallback — covered explicitly because browser geolocation grant
      // rates are lower than native, this path will get used in practice.
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setLocationLabel('Current location'),
      () => {
        /* Permission denied — keep the existing manual label. */
      }
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Location selector */}
      <button
        onClick={handleUseCurrentLocation}
        className="mb-4 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-ink shadow-sm transition hover:border-primary"
      >
        <span className="text-primary">📍</span>
        <span>{locationLabel}</span>
        <span className="text-muted">·</span>
        <span className="text-primary">Change</span>
      </button>

      {/* Search bar */}
      <div className="mb-8">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search stores by name or area"
          className="w-full rounded-2xl border border-border bg-surface px-5 py-4 text-base font-medium text-ink shadow-sm outline-none transition focus:border-primary"
        />
      </div>

      {/* Nearest stores */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Nearest Stores</h2>
        {filteredNearby.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            No stores match &ldquo;{searchQuery}&rdquo;. Try a different search.
          </p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
            {filteredNearby.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        )}
      </section>

      {/* Recommended stores */}
      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Recommended For You</h2>
        <div className="flex flex-col gap-3">
          {MOCK_RECOMMENDED_STORES.map((store) => (
            <StoreCard key={store.id} store={store} layout="row" />
          ))}
        </div>
      </section>
    </div>
  );
}
