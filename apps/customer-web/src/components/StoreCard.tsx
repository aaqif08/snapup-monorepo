import Link from 'next/link';
import type { NearbyStore } from '@/lib/api';

/**
 * `distanceKm` is optional because it genuinely is: a customer who declined location
 * access has no distance, and the card shows the store's area instead of inventing one.
 * The previous version read a hardcoded constant, which meant every shopper was told the
 * same distance regardless of where they were standing.
 */
function DistanceLabel({ store }: { store: NearbyStore }) {
  if (store.distanceKm === undefined) {
    return <span className="text-xs font-bold text-muted">Tap for details</span>;
  }
  return <span className="text-xs font-bold text-primary">{store.distanceKm.toFixed(1)} km away</span>;
}

function OpenLabel({ isOpen }: { isOpen: boolean }) {
  return (
    <span className={`text-[10px] font-extrabold ${isOpen ? 'text-primary' : 'text-red-500'}`}>
      {isOpen ? 'OPEN' : 'CLOSED'}
    </span>
  );
}

export default function StoreCard({
  store,
  layout = 'card',
}: {
  store: NearbyStore;
  layout?: 'card' | 'row';
}) {
  if (layout === 'row') {
    return (
      <Link
        href={`/store/${store.id}`}
        className="flex min-w-[260px] items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary sm:min-w-0"
      >
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-bg text-2xl">
          🏪
        </div>
        <div className="flex-1">
          <p className="font-extrabold text-ink">{store.name}</p>
          <p className="text-xs text-muted">{store.address}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <DistanceLabel store={store} />
          <OpenLabel isOpen={store.isOpen} />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/store/${store.id}`}
      className="min-w-[240px] flex-shrink-0 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary sm:min-w-0"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-bg text-2xl">
        🏪
      </div>
      <p className="mb-1 font-extrabold text-ink">{store.name}</p>
      <p className="mb-3 text-xs text-muted">{store.address}</p>
      <div className="flex items-center justify-between">
        <DistanceLabel store={store} />
        <OpenLabel isOpen={store.isOpen} />
      </div>
    </Link>
  );
}
