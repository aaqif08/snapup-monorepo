import 'server-only';
import { processSingleton } from '../singleton';

/**
 * A small TTL cache in front of the retailer's API.
 *
 * This is not an optimisation, it is a requirement of the deployment. `validateSession()`
 * re-reads the store record on **every** authenticated request in order to re-check the
 * authorized network ranges — which was free against process memory and cheap against our
 * own Postgres, but against a third party's API means one upstream call per barcode scan,
 * per heartbeat, per order. Uncached, a busy store would spend its rate limit on
 * re-fetching the same unchanged store record hundreds of times a minute.
 *
 * The trade this makes, stated plainly because it weakens a security property: with a TTL
 * of `n` seconds, deactivating a store or correcting its egress range takes up to `n`
 * seconds to affect sessions already in flight, where previously it was immediate. The TTL
 * is therefore deliberately short — seconds, not minutes — so the window stays smaller than
 * the time it takes an operator to notice they need to act.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 1000) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Bounded so a scan of many distinct barcodes cannot grow the cache without limit.
    // Evicting the oldest inserted key is crude but adequate: entries expire on time
    // anyway, so this only ever matters under a burst of unique keys.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Dropped explicitly after a write, so an operator who corrects a store's network range
   * or withdraws a product sees the effect immediately rather than waiting out the TTL.
   * Without this the admin console would appear not to have saved.
   */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Process-pinned for the same reason the repositories are: Next.js bundles each route
 * separately, so a module-level `new TtlCache()` would give each route its own cache and
 * an invalidation performed by the admin route would not be seen by the product route.
 */
export function sharedCache<T>(key: string, ttlMs: number, maxEntries?: number): TtlCache<T> {
  return processSingleton(`storeApi.cache.${key}`, () => new TtlCache<T>(ttlMs, maxEntries));
}
