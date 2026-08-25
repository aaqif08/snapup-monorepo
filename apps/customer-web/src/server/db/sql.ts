import 'server-only';

export type SqlRows = Record<string, unknown>[];

/**
 * A statement built but not yet run.
 *
 * Neon's tagged template returns one of these rather than a plain promise, which is what
 * lets `transaction([...])` collect several and send them as one atomic unit. It is
 * `PromiseLike`, so `await sql\`…\`` still works and callers that do not need a transaction
 * never notice the difference.
 *
 * The embedded adapter reproduces the same shape. Without it, building the array of
 * statements that `createOrder` passes to `transaction` would execute each one immediately
 * and *outside* any transaction — an order whose lines are written non-atomically, which is
 * exactly the failure the transaction is there to prevent.
 */
export interface LazyQuery extends PromiseLike<SqlRows> {
  readonly statement: string;
  readonly values: readonly unknown[];
}

/**
 * The one database interface the repositories are written against.
 *
 * Both backends satisfy it: Neon's HTTP driver natively, and PGlite through the adapter in
 * `embedded.ts`. Having the repositories depend on this rather than on a driver type is
 * what makes the choice between hosted and embedded Postgres a URL scheme rather than a
 * rewrite.
 */
export interface SqlClient {
  /** Tagged-template form. Every `${}` becomes a bound parameter, never interpolated text. */
  (strings: TemplateStringsArray, ...values: unknown[]): LazyQuery;

  /**
   * Plain-statement form, for the few places where part of the SQL is a shared constant
   * (`ORDER_SELECT`) or is read from a file (the migration runner). Parameters are still
   * bound — `$1` in the text, values in the array — so this is not interpolation.
   */
  (statement: string, values?: unknown[]): Promise<SqlRows>;

  /** Runs every statement atomically. */
  transaction(queries: LazyQuery[]): Promise<SqlRows[]>;
}
