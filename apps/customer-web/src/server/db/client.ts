import 'server-only';
import { neon } from '@neondatabase/serverless';
import { processSingleton } from '../singleton';
import { embeddedClient, embeddedDataDir } from './embedded';
import type { LazyQuery, SqlClient, SqlRows } from './sql';

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

    return withConnectRetry(neon(url));
  });
}

/**
 * How many times a statement is re-sent after the database could not be reached at all.
 *
 * Neon suspends its compute when the shop has been quiet for a few minutes, and the first
 * request after that has to wake it. Waking takes longer than the driver waits for a
 * connection, so that request fails with `Error connecting to database: fetch failed`
 * before Postgres ever sees it — the customer gets a 500, taps again, and the second
 * attempt lands on a compute that is now awake. That was the "first click errors, second
 * goes through" report from the pilot.
 *
 * Two retries with a pause between them cover the wake-up. Only a *connection* failure is
 * retried: the statement never reached the server, so sending it again cannot double
 * anything. A statement that reached Postgres and failed there is not retried, whatever
 * the error, because the caller cannot tell whether it partly happened.
 */
const CONNECT_RETRIES = 2;
const CONNECT_RETRY_DELAYS_MS = [400, 1200];

function isConnectFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = String((error as { message?: unknown }).message ?? '');
  return /error connecting to database/i.test(message);
}

async function retryingConnect<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isConnectFailure(error) || tries >= CONNECT_RETRIES) throw error;
      const delay = CONNECT_RETRY_DELAYS_MS[tries] ?? CONNECT_RETRY_DELAYS_MS.at(-1)!;
      console.warn(
        `[db] could not reach the database (attempt ${tries + 1}); retrying in ${delay} ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Mirrors `toStatement` in `embedded.ts`, so a LazyQuery reads the same on both engines. */
function toStatement(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
}

type NeonClient = ReturnType<typeof neon>;

/**
 * Wraps Neon's HTTP client so every execution path — tagged template, plain statement,
 * and `transaction` — survives a compute wake-up.
 *
 * The tagged form has to stay lazy: `transaction([...])` collects several of these and
 * sends them as one request, so building the underlying Neon query is deferred until the
 * moment it is awaited or batched. A wrapped query carries a `build` that produces a fresh
 * Neon query per attempt, which is what makes retrying it sound.
 */
function withConnectRetry(raw: NeonClient): SqlClient {
  type Wrapped = LazyQuery & { build: () => PromiseLike<SqlRows> };

  const client = ((first: TemplateStringsArray | string, ...rest: unknown[]) => {
    if (typeof first === 'string') {
      const values = Array.isArray(rest[0]) ? (rest[0] as unknown[]) : [];
      return retryingConnect(
        () => (raw as unknown as (q: string, p?: unknown[]) => Promise<SqlRows>)(first, values)
      );
    }

    const build = () => raw(first, ...rest) as unknown as PromiseLike<SqlRows>;
    const lazy: Wrapped = {
      statement: toStatement(first, rest),
      values: rest,
      build,
      then: (onFulfilled, onRejected) =>
        retryingConnect(() => Promise.resolve(build())).then(onFulfilled, onRejected),
    };
    return lazy;
  }) as SqlClient;

  client.transaction = (queries: LazyQuery[]) =>
    retryingConnect(() =>
      (raw as unknown as { transaction: (q: unknown[]) => Promise<SqlRows[]> }).transaction(
        queries.map((query) => (query as Wrapped).build())
      )
    );

  return client;
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
