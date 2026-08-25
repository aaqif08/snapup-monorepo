import 'server-only';

/**
 * Connection details for the retailer's own API.
 *
 * The deployment model this exists for: the supermarket hosts the database, only the store
 * owner can reach it, and SnapUp is given an API key rather than a connection string. We
 * therefore never hold their data — we ask for it per request and hold nothing but a
 * short-lived cache.
 *
 * That is a stronger position than it might look. SnapUp cannot leak a database it cannot
 * reach, and the retailer can revoke our access without touching their infrastructure. The
 * cost is that their API is now on the critical path of every customer request, which is
 * what `client.ts` and the caches are built around.
 */
export const STORE_API_BASE = process.env.SNAPUP_STORE_API_BASE ?? '';

/**
 * Read at module load and never logged. Like the other secrets in `env.ts` this carries no
 * `NEXT_PUBLIC_` prefix, which is what keeps it out of the browser bundle — a key inlined
 * into client JavaScript is a key every customer can read and replay against the
 * retailer's own systems.
 */
export const STORE_API_KEY = process.env.SNAPUP_STORE_API_KEY ?? '';

/**
 * Per-attempt budget. Requirement 3 asks for a barcode lookup inside ~2 seconds
 * end-to-end, and that budget now has to cover a round trip to somebody else's
 * infrastructure. 800 ms per attempt with at most one retry keeps the worst case under
 * ~1.7 s including our own overhead, so a slow upstream degrades into a clean error inside
 * the requirement rather than hanging until the browser gives up.
 */
export const STORE_API_TIMEOUT_MS = Number(process.env.SNAPUP_STORE_API_TIMEOUT_MS ?? 800);

/**
 * Both must be present. A base URL with no key would fail on the first authenticated call
 * and a key with no base URL has nowhere to go, so treating the pair as one switch avoids
 * a half-configured deployment that starts and then fails per-request.
 */
export function isStoreApiConfigured(): boolean {
  return STORE_API_BASE.length > 0 && STORE_API_KEY.length > 0;
}
