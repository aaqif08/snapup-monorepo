import 'server-only';
import { processSingleton } from '../singleton';
import { acquireDatabaseLock } from './lock';
import type { LazyQuery, SqlClient, SqlRows } from './sql';

/**
 * An embedded Postgres, for deployments that have no Postgres server.
 *
 * PGlite is the real PostgreSQL engine compiled to WebAssembly, running inside this
 * process and persisting to a directory on disk. It is not a mock and not a
 * SQL-compatible substitute: `jsonb`, `text[]`, partial indexes, `CHECK` constraints,
 * regex operators and dollar-quoted `DO` blocks all behave as they do on a server,
 * because it *is* the server.
 *
 * ## Why this exists
 *
 * The alternative for a machine with no Postgres and no Docker was the in-memory
 * repositories — which lose every account on a restart, and in Next dev lose them on a
 * route recompile. That is not a database; it is a cache that looks like one until the
 * first time it matters. An embedded engine gives durable accounts with nothing to
 * install.
 *
 * ## What it is not
 *
 * Single-process. One Node process may open a given data directory; a second will fail
 * on the lock rather than silently diverge, which is the correct failure. That makes it
 * right for a pilot on one box and wrong for serverless fan-out — which is exactly what
 * the Neon HTTP driver in `client.ts` is for. The two are selected by the URL scheme, so
 * moving from one to the other is a configuration change and not a code change.
 */

/** Kept lazily so the WASM engine is never booted by a deployment using hosted Postgres. */
type PGliteQuery = (sql: string, params?: unknown[]) => Promise<{ rows: SqlRows }>;

type PGliteInstance = {
  query: PGliteQuery;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(callback: (tx: { query: PGliteQuery }) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

async function open(dataDir: string): Promise<PGliteInstance> {
  // Taken before the engine starts. PGlite does not lock its directory, so a second
  // process would silently revert this one's writes — see `lock.ts` for the incident that
  // motivated this. Throwing here turns invisible data loss into a startup error.
  acquireDatabaseLock(dataDir);

  // Imported dynamically, not at module scope. A static import would pull ~10 MB of WASM
  // into every route bundle that touches the database layer, including the ones running
  // against hosted Postgres where it is dead weight.
  const { PGlite } = await import('@electric-sql/pglite');
  return (await PGlite.create(dataDir)) as unknown as PGliteInstance;
}

/**
 * Turns a `DATABASE_URL` into a data directory, or null when this is not an embedded URL.
 *
 * Accepted:
 *   `pglite://./.data/snapup`   explicit
 *   `file:./.data/snapup`       the conventional spelling for a local file store
 */
export function embeddedDataDir(url: string): string | null {
  for (const prefix of ['pglite://', 'file:']) {
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length);
      // `file://./x` and `file:./x` are both written in the wild; normalise the former.
      return path.startsWith('//') ? path.slice(2) : path;
    }
  }
  return null;
}

/**
 * A tagged-template client over PGlite, matching the shape the repositories already use.
 *
 * The repositories are written against Neon's tagged-template API — ``sql`SELECT … ${id}` ``
 * — which interpolates values as bound parameters rather than as text. This rebuilds the
 * same contract: the template's static parts become the statement, and every `${}` becomes
 * `$1`, `$2`… That is what keeps the parameterisation, and with it the injection safety,
 * identical across the two backends rather than depending on which one is configured.
 */
export function embeddedClient(dataDir: string): SqlClient {
  const connect = () => processSingleton(`db.pglite:${dataDir}`, () => open(dataDir));

  /** `SELECT ${a}, ${b}` -> `SELECT $1, $2`, so values stay bound rather than interpolated. */
  function toStatement(strings: TemplateStringsArray, values: unknown[]): string {
    return strings.reduce(
      (accumulator, part, index) =>
        accumulator + part + (index < values.length ? `$${index + 1}` : ''),
      ''
    );
  }

  async function run(statement: string, values: unknown[]): Promise<SqlRows> {
    const database = await connect();
    return (await database.query(statement, values.length > 0 ? values : undefined)).rows;
  }

  const client = ((first: TemplateStringsArray | string, ...rest: unknown[]) => {
    // Plain-statement form. Neon takes the parameters as a single array in the second
    // argument, so they must be unwrapped rather than passed through as `[[id]]` — which
    // would bind one array-valued parameter and match nothing.
    if (typeof first === 'string') {
      const values = Array.isArray(rest[0]) ? (rest[0] as unknown[]) : [];
      return run(first, values);
    }

    // Tagged-template form, returned lazily. Deferring execution is what lets
    // `transaction([...])` collect several statements and run them atomically; awaiting the
    // object directly runs it on its own, which is what every other caller does.
    const statement = toStatement(first, rest);
    const lazy: LazyQuery = {
      statement,
      values: rest,
      then: (onFulfilled, onRejected) => run(statement, rest).then(onFulfilled, onRejected),
    };
    return lazy;
  }) as SqlClient;

  client.transaction = async (queries: LazyQuery[]): Promise<SqlRows[]> => {
    const database = await connect();

    // A real `BEGIN`/`COMMIT` around the batch. Neon's HTTP driver achieves the same
    // atomicity by sending the batch as one request; the guarantee the caller depends on —
    // an order and its lines are either all written or none are — holds either way.
    return database.transaction(async (tx) => {
      const results: SqlRows[] = [];
      for (const query of queries) {
        const values = [...query.values];
        results.push((await tx.query(query.statement, values.length > 0 ? values : undefined)).rows);
      }
      return results;
    });
  };

  return client;
}

/** Applies a whole SQL file in one call, so dollar-quoted blocks survive intact. */
export async function embeddedExec(dataDir: string, sql: string): Promise<void> {
  const database = await processSingleton(`db.pglite:${dataDir}`, () => open(dataDir));
  await database.exec(sql);
}
