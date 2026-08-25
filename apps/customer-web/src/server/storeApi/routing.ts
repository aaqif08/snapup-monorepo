import 'server-only';
import { storeRepository } from '../stores/repository';
import { connectionForStore, platformConnection, type StoreApiConnection } from './connection';

/**
 * Resolves which branch endpoint a store-scoped call should use.
 *
 * ## Why this is a separate module
 *
 * `connection.ts` is pure — it maps a store record to a connection and touches nothing
 * else. This one reaches into the store registry, which means it must not be imported by
 * anything the registry itself depends on. Keeping them apart makes that boundary
 * something the import graph enforces rather than something a comment asks for.
 *
 * ## The cycle this avoids
 *
 * The store *registry* deliberately does not route per branch. Resolving a branch's
 * endpoint requires reading that branch's record, and reading it from its own endpoint
 * has no base case — someone has to know where the branches are before you can ask them
 * anything. So `stores/apiRepository.ts` calls the client with no connection and gets the
 * platform one, while catalogue, orders and analytics resolve per branch through here.
 */

/**
 * Ten seconds.
 *
 * Endpoint configuration changes when a branch is re-plumbed, which is a scheduled event
 * measured in months — but this sits on the barcode-scan path, and an uncached lookup
 * would add a registry round trip to every scan for a value that essentially never moves.
 * Ten seconds is short enough that an operator who repoints a branch and refreshes sees
 * the change, and long enough to remove the lookup from the hot path entirely.
 */
const CONNECTION_TTL_MS = 10_000;

interface CacheEntry {
  connection: StoreApiConnection | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * The connection for one branch, or null when it has none that resolves.
 *
 * Null is returned rather than throwing so the caller decides what a missing endpoint
 * means for its own operation — a catalogue read degrades to "no products", whereas an
 * order write must surface a hard failure.
 *
 * Note what this does *not* do: fall back to the platform connection when a branch names
 * a key reference that the deployment cannot resolve. For a chain where each branch hosts
 * its own database, falling back would send one branch's request authenticated as
 * another — a cross-tenant call, not a graceful degradation.
 */
export async function connectionForStoreId(storeId: string): Promise<StoreApiConnection | null> {
  const now = Date.now();
  const cached = cache.get(storeId);
  if (cached && cached.expiresAt > now) return cached.connection;

  let connection: StoreApiConnection | null;
  try {
    const store = await storeRepository.findById(storeId);
    // An unknown store gets the platform connection rather than null. The caller is about
    // to ask about a store that does not exist, and the upstream 404 is a better answer
    // than a configuration error that sends them looking at environment variables.
    connection = store ? connectionForStore(store) : platformConnection();
  } catch {
    // A registry outage must not be reported as "this branch is misconfigured", which is
    // what null would say. Fall back to the platform endpoint and let the call fail on its
    // own terms if it is going to.
    connection = platformConnection();
  }

  cache.set(storeId, { connection, expiresAt: now + CONNECTION_TTL_MS });
  return connection;
}

/** Drops a branch's cached endpoint, so an admin edit takes effect on the next call. */
export function invalidateConnection(storeId: string): void {
  cache.delete(storeId);
}

export function invalidateAllConnections(): void {
  cache.clear();
}
