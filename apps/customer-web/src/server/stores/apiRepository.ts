import 'server-only';
import { storeApiFind, storeApiRequest } from '../storeApi/client';
import { sharedCache } from '../storeApi/cache';
import { invalidateConnection } from '../storeApi/routing';
import {
  PATHS,
  fromStoreDraft,
  fromStorePatch,
  toStoreRecord,
  type StoreDto,
} from '../storeApi/contract';
import type { StoreDraft, StoreRecord, StoreRepository } from './types';

/**
 * The store registry, read from the retailer's API.
 *
 * This is the repository where the API-key deployment model bites hardest, because
 * `findById` is not an occasional lookup — `validateSession()` calls it on **every**
 * authenticated request to re-check the store's authorized egress ranges. Left uncached
 * that is one upstream round trip per barcode scan, per heartbeat, per order, which would
 * both blow the Requirement 3 latency budget and burn the retailer's rate limit on
 * re-reading a record that changes perhaps once a month.
 *
 * Hence the short TTL below, and the explicit invalidation on write.
 *
 * ## This repository alone is not routed per branch
 *
 * Every other API repository resolves the branch's own endpoint via
 * `storeApi/routing.ts`. This one deliberately does not, and must not: resolving a
 * branch's endpoint means reading that branch's record, and reading it from its own
 * endpoint has no base case. Someone has to know where the branches are before you can
 * ask them anything, so the registry always uses the platform connection — which is what
 * omitting `connection` from these calls selects.
 */

/**
 * Fifteen seconds.
 *
 * Chosen against the security property it weakens rather than against a hit rate.
 * Deactivating a store or correcting its egress range previously took effect on in-flight
 * sessions immediately; it now takes up to this long. Fifteen seconds is shorter than the
 * time it takes an operator to make the change and look up at the shop floor, and it still
 * removes better than 99% of the upstream calls on a busy store.
 */
const STORE_CACHE_TTL_MS = 15_000;

function cache() {
  return sharedCache<StoreRecord>('stores', STORE_CACHE_TTL_MS);
}

class ApiStoreRepository implements StoreRepository {
  async findById(id: string): Promise<StoreRecord | null> {
    const cached = cache().get(id);
    if (cached) return { ...cached };

    const dto = await storeApiFind<StoreDto>(PATHS.storeById(id));

    // A miss is deliberately not cached. Caching "no such store" would mean a store
    // registered moments ago stays invisible for the length of the TTL, and the negative
    // case is rare enough that re-asking costs nothing.
    if (!dto) return null;

    const record = toStoreRecord(dto);
    cache().set(id, record);
    return { ...record };
  }

  async listActive(): Promise<StoreRecord[]> {
    // Not cached: the customer-facing directory is requested far less often than the auth
    // path, and a stale list would show a shopper a store that has just been withdrawn.
    const dtos = await storeApiRequest<StoreDto[]>(PATHS.stores, {
      query: { is_active: 'true' },
    });
    return (dtos ?? []).map(toStoreRecord);
  }

  async listAll(): Promise<StoreRecord[]> {
    const dtos = await storeApiRequest<StoreDto[]>(PATHS.stores);
    return (dtos ?? []).map(toStoreRecord);
  }

  async create(draft: StoreDraft): Promise<StoreRecord> {
    const dto = await storeApiRequest<StoreDto>(PATHS.stores, {
      method: 'POST',
      body: fromStoreDraft(draft),
    });
    return toStoreRecord(dto);
  }

  async update(id: string, patch: Partial<StoreDraft>): Promise<StoreRecord | null> {
    const dto = await storeApiFind<StoreDto>(PATHS.storeById(id), {
      method: 'PATCH',
      body: fromStorePatch(patch),
    });

    // Invalidated whether or not the write succeeded in returning a body. An operator who
    // corrects a store's network range and then watches customers keep being refused for
    // another fifteen seconds would reasonably conclude the save had not worked.
    cache().invalidate(id);

    // The routing cache holds a connection derived from this record, so an edit that
    // repoints a branch's API has to drop it too — otherwise catalogue calls keep going to
    // the old endpoint for another ten seconds after the console says the change is saved.
    invalidateConnection(id);

    if (!dto) return null;

    const record = toStoreRecord(dto);
    cache().set(id, record);
    return { ...record };
  }
}

export const apiStoreRepository: StoreRepository = new ApiStoreRepository();
