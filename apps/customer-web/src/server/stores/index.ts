import 'server-only';
import { distanceKm } from './geo';
import { storeRepository } from './memoryRepository';
import { toPublicStore } from './projection';
import type { PublicStore, StoreRecord } from './types';

export { storeRepository, isValidCidr } from './memoryRepository';
export { toPublicStore } from './projection';
export { distanceKm, isValidLatitude, isValidLongitude } from './geo';
export type { StoreRecord, StoreDraft, PublicStore, StoreRepository } from './types';

/**
 * Store lookup used by the authentication path.
 *
 * Returns inactive stores too, and callers on the auth path must check `isActive`
 * themselves. Keeping the two concerns separate means "this store does not exist" and
 * "this store is switched off" stay distinguishable in logs, instead of collapsing into
 * one indistinguishable failure.
 */
export async function getStore(storeId: string): Promise<StoreRecord | null> {
  return storeRepository.findById(storeId);
}

export interface NearbyQuery {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  limit: number;
}

/**
 * The customer-facing directory.
 *
 * With coordinates: active stores within `radiusKm`, nearest first. Without: active
 * stores in registration order and no distances, which is the honest answer when the
 * customer has declined location access — rather than inventing a distance, as the
 * previous hardcoded `distanceKm` constants did.
 */
export async function findNearbyStores(query: NearbyQuery): Promise<PublicStore[]> {
  const active = await storeRepository.listActive();

  if (query.latitude === undefined || query.longitude === undefined) {
    return active.slice(0, query.limit).map((store) => toPublicStore(store));
  }

  const withDistance = active.map((store) => ({
    store,
    km: distanceKm(query.latitude!, query.longitude!, store.latitude, store.longitude),
  }));

  const withinRadius =
    query.radiusKm === undefined
      ? withDistance
      : withDistance.filter((entry) => entry.km <= query.radiusKm!);

  return withinRadius
    .sort((a, b) => a.km - b.km)
    .slice(0, query.limit)
    .map((entry) => toPublicStore(entry.store, entry.km));
}
