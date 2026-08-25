import 'server-only';
import { distanceKm } from './geo';
import { hasCoordinates } from './readiness';
import { storeRepository } from './repository';
import { toPublicStore } from './projection';
import type { PublicStore, StoreRecord } from './types';

export { storeRepository } from './repository';
export { isValidCidr } from './cidr';
export { toPublicStore } from './projection';
export { distanceKm, isValidLatitude, isValidLongitude } from './geo';
export {
  explainGap,
  hasCoordinates,
  readinessReport,
  storeReadiness,
} from './readiness';
export type { ReadinessGap, StoreReadiness } from './readiness';
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
 *
 * A branch whose own coordinates have not been surveyed cannot be ranked, so it is
 * listed *after* everything that can, with no distance shown. Dropping it would tell a
 * customer standing outside the shop that it does not exist; ranking it as though it
 * were at `0, 0` would bury it behind every branch in the state. Appending it is the
 * only option that neither lies nor hides.
 */
export async function findNearbyStores(query: NearbyQuery): Promise<PublicStore[]> {
  const active = await storeRepository.listActive();

  if (query.latitude === undefined || query.longitude === undefined) {
    return active.slice(0, query.limit).map((store) => toPublicStore(store));
  }

  const locatable: { store: StoreRecord; km: number }[] = [];
  const unsurveyed: StoreRecord[] = [];

  for (const store of active) {
    if (hasCoordinates(store)) {
      locatable.push({
        store,
        km: distanceKm(query.latitude, query.longitude, store.latitude, store.longitude),
      });
    } else {
      unsurveyed.push(store);
    }
  }

  const withinRadius =
    query.radiusKm === undefined
      ? locatable
      : locatable.filter((entry) => entry.km <= query.radiusKm!);

  const ranked = withinRadius
    .sort((a, b) => a.km - b.km)
    .map((entry) => toPublicStore(entry.store, entry.km));

  return [...ranked, ...unsurveyed.map((store) => toPublicStore(store))].slice(0, query.limit);
}
