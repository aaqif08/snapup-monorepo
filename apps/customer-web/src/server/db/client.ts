import 'server-only';
import { neon } from '@neondatabase/serverless';
import { processSingleton } from '../singleton';
import { embeddedClient, embeddedDataDir } from './embedded';
import type { SqlClient } from './sql';

/**
 * The database connection, and the switch that decides whether there is one at all.
 *
 * Driver choice is not incidental. The failure this whole change exists to fix is
 * serverless fan-out — many short-lived instances, each holding its own slice of the truth.
 * A conventional TCP pool makes that worse rather than better: every instance opens its own
 * connections, and Postgres runs out of backends long before the traffic is interesting.
 * `@neondatabase/serverless` issues each query over HTTP with no connection to keep alive,
 * so an instance that handles one request costs one request.
 *
 * The cost of that trade is real and worth stating: there is no session state, so no
 * `BEGIN`/`COMMIT` across statements on this path. Nothing here needs one — every write
 * below is a single statement, and the two-statement read-merge-write in `update()` is
 * documented where it happens.
 */
export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

/**
 * Process-pinned for the same reason the in-memory repositories are: Next.js bundles each
 * route separately, so a module-level `neon(...)` runs once per route bundle. That is
 * cheaper here than it was for the memory repositories — no state is lost, only duplicated
 * setup — but there is no reason to pay it.
 */
export function db(): SqlClient {
  return processSingleton('db.client', () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      // Reached only if a repository was constructed without checking
      // `isDatabaseConfigured()` first, which is a wiring bug rather than a runtime state.
      throw new Error(
        'DATABASE_URL is not set. The Postgres repositories must not be constructed without it.'
      );
    }

    // `file:` / `pglite:` selects the embedded engine — real Postgres in this process,
    // persisted to a directory. Anything else is a network URL for the HTTP driver above.
    // The repositories cannot tell the difference, which is the point.
    const dataDir = embeddedDataDir(url);
    if (dataDir) return embeddedClient(dataDir);

    return neon(url) as unknown as SqlClient;
  });
}

/** Which engine is in use, for the health endpoint and the console's setup warning. */
export function databaseKind(): 'none' | 'embedded' | 'postgres' {
  const url = process.env.DATABASE_URL;
  if (!url) return 'none';
  return embeddedDataDir(url) ? 'embedded' : 'postgres';
}

/**
 * Postgres `unique_violation`. Used to turn a race on `(store_id, barcode)` into the same
 * `DuplicateBarcodeError` the pre-insert check would have produced — see the note in
 * `products/postgresRepository.ts` about why the check alone is not enough.
 */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Epoch milliseconds are stored as `bigint`, which the driver returns as a string to avoid
 * the precision loss a JavaScript number would suffer above 2^53. Timestamps are far below
 * that, so the conversion back is safe — but it has to be explicit, because
 * `"1786579200000" < 1786579300000` compares a string to a number and silently answers
 * nonsense.
 */
export function toEpochMs(value: unknown): number {
  return typeof value === 'string' ? Number(value) : (value as number);
}

export function toEpochMsOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toEpochMs(value);
}
