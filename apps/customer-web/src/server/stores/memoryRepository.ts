import 'server-only';
import { credentialFieldsFor, wifiFieldsFor } from './credentials';
import { STORE_SEED } from './seed';
import type { StoreDraft, StoreRecord, StoreRepository } from './types';

/**
 * In-memory store registry backing the POC.
 *
 * Mutable on purpose: the admin console adds and edits stores at runtime, and
 * `validateSession()` re-reads the registry on every request so that deactivating a store
 * or correcting its network range takes effect on sessions already in flight rather than
 * waiting up to 30 minutes for them to expire.
 *
 * Being process memory, this shares the limitation the product catalogue has — edits do
 * not survive a redeploy and are not visible to other serverless instances. Moving to
 * Postgres means implementing `StoreRepository` against it and changing one export in
 * `index.ts`; the geo query becomes a PostGIS `ST_DWithin` / `ST_Distance` against a
 * GEOGRAPHY column, and nothing that calls the repository changes.
 */
class InMemoryStoreRepository implements StoreRepository {
  private readonly stores = new Map<string, StoreRecord>();
  private nextId: number;

  constructor(seed: StoreRecord[]) {
    for (const store of seed) {
      if (this.stores.has(store.id)) {
        throw new Error(`Duplicate store id in seed: ${store.id}`);
      }
      this.stores.set(store.id, { ...store });
    }

    // Continue the `store_N` sequence past whatever the seed used, so a generated id can
    // never collide with a seeded one.
    const highest = seed.reduce((max, store) => {
      const numeric = Number(/^store_(\d+)$/.exec(store.id)?.[1]);
      return Number.isInteger(numeric) && numeric > max ? numeric : max;
    }, 0);
    this.nextId = highest + 1;
  }

  async findById(id: string): Promise<StoreRecord | null> {
    const store = this.stores.get(id);
    return store ? { ...store } : null;
  }

  async listActive(): Promise<StoreRecord[]> {
    return [...this.stores.values()].filter((store) => store.isActive).map((store) => ({ ...store }));
  }

  async listAll(): Promise<StoreRecord[]> {
    return [...this.stores.values()].map((store) => ({ ...store }));
  }

  async create(draft: StoreDraft): Promise<StoreRecord> {
    const id = `store_${this.nextId}`;
    this.nextId += 1;

    const record: StoreRecord = {
      ...credentialFieldsFor(draft.apiKey),
      ...wifiFieldsFor(draft.wifiPassword),
      networkUpdatedAt: Date.now(),
      networkUpdatedBy: draft.networkUpdatedBy ?? null,
      opensAtMinutes: draft.opensAtMinutes ?? null,
      closesAtMinutes: draft.closesAtMinutes ?? null,
      id,
      name: draft.name,
      address: draft.address,
      latitude: draft.latitude,
      longitude: draft.longitude,
      authorizedEgressCidrs: [...draft.authorizedEgressCidrs],
      advertisedSsid: draft.advertisedSsid,
      merchantVpa: draft.merchantVpa,
      merchantDisplayName: draft.merchantDisplayName,
      apiBaseUrl: draft.apiBaseUrl,
      apiKeyRef: draft.apiKeyRef,
      isActive: draft.isActive,
      isOpen: draft.isOpen,
    };

    this.stores.set(id, record);
    return { ...record };
  }

  async update(id: string, patch: Partial<StoreDraft>): Promise<StoreRecord | null> {
    const existing = this.stores.get(id);
    if (!existing) return null;

    const updated: StoreRecord = {
      ...existing,
      ...patch,
      // Copy the array rather than aliasing the caller's, so a later mutation of the
      // request payload cannot silently rewrite a store's authorized network.
      authorizedEgressCidrs: patch.authorizedEgressCidrs
        ? [...patch.authorizedEgressCidrs]
        : existing.authorizedEgressCidrs,
      id: existing.id,
    };

    this.stores.set(id, updated);
    return { ...updated };
  }
}

export const memoryStoreRepository: StoreRepository = new InMemoryStoreRepository(STORE_SEED);
