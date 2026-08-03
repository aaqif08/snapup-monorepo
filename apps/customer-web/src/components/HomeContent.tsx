'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StoreCard from '@/components/StoreCard';
import { fetchNearbyStores, type NearbyStore } from '@/lib/api';
import { useDeviceLocation } from '@/lib/useDeviceLocation';

/** Matches the server default. Widened automatically if nothing is in range. */
const DEFAULT_RADIUS_KM = 25;
const WIDE_RADIUS_KM = 200;

export default function HomeContent() {
  const { status, location, message, request } = useDeviceLocation();

  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [widened, setWidened] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setWidened(false);

    try {
      const coords = location ?? undefined;
      let result = await fetchNearbyStores(coords, DEFAULT_RADIUS_KM);

      // Nothing within the default radius is a real outcome for a POC with five stores in
      // one city, and an empty screen would look broken rather than informative. Retry
      // once at a wide radius and say so, instead of implying SnapUp has no stores.
      if (coords && result.stores.length === 0) {
        result = await fetchNearbyStores(coords, WIDE_RADIUS_KM);
        if (result.stores.length > 0) setWidened(true);
      }

      setStores(result.stores);
    } catch {
      setLoadError('Could not load stores. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [location]);

  // Re-runs when a location arrives, so the unordered list is replaced by a ranked one
  // the moment the customer grants access.
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return stores;
    return stores.filter(
      (store) =>
        store.name.toLowerCase().includes(query) || store.address.toLowerCase().includes(query)
    );
  }, [searchQuery, stores]);

  const nearest = filtered.slice(0, 3);
  const rest = filtered.slice(3);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <LocationBar status={status} message={message} location={location} onRequest={request} />

      <div className="mb-8">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search stores by name or area"
          aria-label="Search stores by name or area"
          className="w-full rounded-2xl border border-border bg-surface px-5 py-4 text-base font-medium text-ink shadow-card outline-none transition duration-200 placeholder:text-muted focus:border-primary"
        />
      </div>

      {widened && (
        <p className="mb-6 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          No stores within {DEFAULT_RADIUS_KM} km, so we widened the search. The nearest
          SnapUp store is {filtered[0]?.distanceKm?.toFixed(1)} km away.
        </p>
      )}

      {isLoading ? (
        <StoreSkeleton />
      ) : loadError ? (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="mb-3 text-sm text-muted">{loadError}</p>
          <button
            onClick={() => void load()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-onPrimary transition duration-200 hover:bg-primaryDark"
          >
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          {searchQuery.trim()
            ? `No stores match “${searchQuery}”. Try a different search.`
            : 'No SnapUp stores are available yet.'}
        </p>
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
              {status === 'granted' ? 'Nearest Stores' : 'SnapUp Stores'}
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
              {nearest.map((store) => (
                <StoreCard key={store.id} store={store} />
              ))}
            </div>
          </section>

          {rest.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
                More Stores
              </h2>
              <div className="flex flex-col gap-3">
                {rest.map((store) => (
                  <StoreCard key={store.id} store={store} layout="row" />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function LocationBar({
  status,
  message,
  location,
  onRequest,
}: {
  status: ReturnType<typeof useDeviceLocation>['status'];
  message: string | null;
  location: { accuracyMeters: number } | null;
  onRequest: () => void;
}) {
  if (status === 'granted' && location) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-bold text-primary">
          📍 Using your location
        </span>
        <span className="text-xs text-muted">
          accurate to about {Math.round(location.accuracyMeters)} m
        </span>
        <button onClick={onRequest} className="text-xs font-bold text-primary hover:underline">
          Refresh
        </button>
      </div>
    );
  }

  if (status === 'locating') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-muted">
        <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
        Finding your location…
      </div>
    );
  }

  // idle / denied / unavailable / error all land here. The button is the only path that
  // triggers a browser prompt, so a customer who declined is never re-prompted unless
  // they ask for it themselves.
  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-ink">
            {status === 'denied' ? 'Location access is off' : 'Find stores near you'}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {message ?? 'Share your location to sort stores by how close they are.'}
          </p>
        </div>
        {status !== 'unavailable' && (
          <button
            onClick={onRequest}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-onPrimary transition duration-200 hover:bg-primaryDark active:scale-[0.99]"
          >
            {status === 'denied' ? 'Try again' : 'Use my location'}
          </button>
        )}
      </div>
    </div>
  );
}

function StoreSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((key) => (
        <div key={key} className="h-36 animate-pulse rounded-2xl border border-border bg-surface" />
      ))}
    </div>
  );
}
