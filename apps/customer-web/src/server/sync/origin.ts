import 'server-only';
import { neon } from '@neondatabase/serverless';
import { embeddedClient, embeddedDataDir } from '@/server/db/embedded';
import type { OutboxEvent } from './outbox';

type OriginSql = (statement: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * A connection to the original database.
 *
 * `file:` and `pglite://` select the embedded engine, exactly as `DATABASE_URL` does for
 * our own database. That is what lets the acceptance suite run section 7 end to end
 * against a second throwaway database on the same machine, rather than leaving the sync
 * as the one path that can only be exercised against somebody's production Postgres.
 */
function originSql(url: string): OriginSql {
  const dataDir = embeddedDataDir(url);
  if (dataDir) return embeddedClient(dataDir) as unknown as OriginSql;
  return neon(url) as unknown as OriginSql;
}

/**
 * The original shop database — the one the duplicate is a copy of.
 *
 * ## Why there is no default mapping
 *
 * Section 7 says to obtain the connection, the permitted tables, the conflict policy, the
 * timezone and the recovery owner in writing, and explicitly not to guess them. That
 * instruction is load-bearing: this job writes to somebody else's production database, and a
 * guessed column name does not fail cleanly — it either errors after a partial write or, far
 * worse, updates a column that exists and means something else.
 *
 * So the mapping is configuration, and its absence is a refusal rather than a fallback. Every
 * piece of it is a sentence someone has to write down, which is the point.
 */

export interface OriginConfig {
  /** Connection string for the original database. Server-side only, never bundled. */
  url: string;
  /** Table receiving stock changes, e.g. `inventory`. */
  inventoryTable: string;
  /** Column identifying the SKU on that table. */
  inventorySkuColumn: string;
  /** Column holding the count, e.g. `available_qty`. */
  inventoryQtyColumn: string;
  /** Column stamped when the row changes, e.g. `last_updated`. Optional. */
  inventoryUpdatedColumn?: string;
  /**
   * How to resolve a row that changed on both sides since the last sync.
   *
   * `origin_wins` never overwrites newer original data, which is what section 7 asks for by
   * default. `duplicate_wins` is available because a shop that has moved its till onto this
   * app may genuinely want the opposite, but it has to be chosen deliberately.
   */
  conflictPolicy: 'origin_wins' | 'duplicate_wins';
}

export class OriginNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `The original shop database is not configured. Missing: ${missing.join(', ')}. ` +
        `Section 7 of the billing brief asks for these in writing before any sync runs; ` +
        `they must not be guessed.`
    );
    this.name = 'OriginNotConfiguredError';
  }
}

/** Reads the mapping, or reports precisely which parts are absent. */
export function originConfig(): OriginConfig | null {
  const url = process.env.SNAPUP_ORIGIN_DATABASE_URL?.trim();
  if (!url) return null;

  const raw = process.env.SNAPUP_ORIGIN_TABLE_MAP?.trim();
  const missing: string[] = [];
  if (!raw) missing.push('SNAPUP_ORIGIN_TABLE_MAP');

  let parsed: Partial<OriginConfig> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<OriginConfig>;
    } catch {
      throw new OriginNotConfiguredError(['SNAPUP_ORIGIN_TABLE_MAP (not valid JSON)']);
    }
  }

  for (const key of ['inventoryTable', 'inventorySkuColumn', 'inventoryQtyColumn'] as const) {
    if (!parsed[key]) missing.push(key);
  }
  if (!parsed.conflictPolicy) missing.push('conflictPolicy');

  if (missing.length > 0) throw new OriginNotConfiguredError(missing);

  return {
    url,
    inventoryTable: parsed.inventoryTable!,
    inventorySkuColumn: parsed.inventorySkuColumn!,
    inventoryQtyColumn: parsed.inventoryQtyColumn!,
    inventoryUpdatedColumn: parsed.inventoryUpdatedColumn,
    conflictPolicy: parsed.conflictPolicy!,
  };
}

/** Identifiers come from configuration, never from an event; quoted, and checked anyway. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`"${name}" is not a plain SQL identifier. Refusing to interpolate it.`);
  }
  return `"${name}"`;
}

/**
 * What became of one event.
 *
 * `applied` and `no_origin_effect` both discharge the event, and they are deliberately not
 * the same word. Marking an event synced says the original database was told something;
 * a payment state change under an inventory-only mapping was never going to tell it
 * anything, and recording that as a successful send would put a write in the log that
 * never happened.
 */
export type OriginDisposition =
  | { applied: true; sku: string; delta: number }
  | { applied: false; reason: string };

/**
 * Applies one outbox event to the original database.
 *
 * Returns only after the original has confirmed the write, so the caller can mark the event
 * synced — section 7 is explicit that the two must be in that order, because an event marked
 * synced on a write that never landed is invisible for ever.
 *
 * One event carries **one** SKU line. That is what makes this a single statement, and a
 * single statement is the only thing that is atomic on this driver — see the note in
 * `outbox.ts` about why a multi-line event cannot be discharged safely here.
 */
export async function applyToOrigin(
  config: OriginConfig,
  event: OutboxEvent
): Promise<OriginDisposition> {
  switch (event.eventType) {
    case 'sale.approved':
    case 'stock.imported': {
      const sku = pickSku(config, event.payload);
      const delta = event.payload.delta;

      if (!sku || !Number.isInteger(delta)) {
        throw new Error(
          `Malformed stock event ${event.eventType} for ${event.subjectId}: ` +
            `${JSON.stringify(event.payload)}`
        );
      }

      const sql = originSql(config.url);
      const step = delta as number;

      // A relative delta, not an absolute value. Writing our count over theirs would
      // discard every sale their own till made since the last run — the "never overwrite
      // newer original-database data blindly" rule, expressed as arithmetic rather than
      // as a comparison we would have to get right.
      const guard =
        config.conflictPolicy === 'origin_wins' && step < 0
          ? ` AND ${ident(config.inventoryQtyColumn)} >= ${Math.abs(step)}`
          : '';

      const stamp = config.inventoryUpdatedColumn
        ? `, ${ident(config.inventoryUpdatedColumn)} = now()`
        : '';

      const result = await sql(
        `UPDATE ${ident(config.inventoryTable)}
            SET ${ident(config.inventoryQtyColumn)} = ${ident(config.inventoryQtyColumn)} + $2${stamp}
          WHERE ${ident(config.inventorySkuColumn)} = $1${guard}
          RETURNING ${ident(config.inventorySkuColumn)}`,
        [sku, step]
      );

      if ((result as unknown[]).length === 0) {
        // Not silently skipped: either the SKU is unknown to the original or the guard
        // refused a deduction it could not cover. Both need a person.
        throw new Error(
          `Origin refused ${step} for SKU ${sku} — unknown SKU, or insufficient stock under ${config.conflictPolicy}.`
        );
      }

      return { applied: true, sku, delta: step };
    }

    // Money moving is our record, not the original's stock.
    //
    // These used to fall through to the `default` below and throw. Every captured payment
    // therefore sat in the outbox failing eight times before being given up on, and — because
    // one failure is enough — dragged every run that touched one to `partial` or `failed`.
    // A shop watching the sync for real problems would have learned to ignore it, which is
    // the worst outcome an alert can have.
    //
    // The configured mapping describes an inventory table and nothing else, so there is
    // genuinely nowhere for a payment state to go. It is discharged, not sent, and says so.
    case 'payment.captured':
    case 'payment.failed':
    case 'payment.refunded':
      return {
        applied: false,
        reason:
          'The origin mapping covers inventory only; a payment state change has no column ' +
          'there. Stock reaches the original through sale.approved at staff approval.',
      };

    default:
      // Unknown event types are not an error — the log may carry things this version does
      // not sync — but they must not be marked synced either.
      throw new Error(`No origin mapping for event type "${event.eventType}".`);
  }
}

/**
 * The SKU column the retailer keys their inventory by.
 *
 * Both identifiers travel on the event because only the retailer knows which one their
 * system uses. The mapping names the column; if it is the one holding barcodes, the barcode
 * is what has to be matched against it.
 */
function pickSku(config: OriginConfig, payload: Record<string, unknown>): string | null {
  const wantsBarcode = /barcode|ean|upc/i.test(config.inventorySkuColumn);
  const sku = payload[wantsBarcode ? 'barcode' : 'sku'];
  const fallback = payload[wantsBarcode ? 'sku' : 'barcode'];

  if (typeof sku === 'string' && sku.length > 0) return sku;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return null;
}

/**
 * The original's own count for a set of SKUs.
 *
 * Section 7's reconciliation: "compare stock/order totals and report mismatches". Read-only
 * by design — it reports, it never corrects. A disagreement has more than one innocent
 * cause (their till sold something we have not seen, an event is still queued here, someone
 * counted a shelf by hand) and picking one of them automatically is how a reconciliation
 * turns into the corruption it was meant to detect.
 */
export async function readOriginQuantities(
  config: OriginConfig,
  skus: string[]
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (skus.length === 0) return found;

  const sql = originSql(config.url);
  const rows = (await sql(
    `SELECT ${ident(config.inventorySkuColumn)} AS sku,
            ${ident(config.inventoryQtyColumn)} AS qty
       FROM ${ident(config.inventoryTable)}
      WHERE ${ident(config.inventorySkuColumn)} = ANY($1)`,
    [skus]
  )) as { sku: string; qty: number | string }[];

  for (const row of rows) found.set(row.sku, Number(row.qty));
  return found;
}
