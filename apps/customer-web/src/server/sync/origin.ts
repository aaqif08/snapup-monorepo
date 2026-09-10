import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { OutboxEvent } from './outbox';

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
 * Applies one outbox event to the original database.
 *
 * Returns only after the original has confirmed the write, so the caller can mark the event
 * synced — section 7 is explicit that the two must be in that order, because an event marked
 * synced on a write that never landed is invisible for ever.
 */
export async function applyToOrigin(config: OriginConfig, event: OutboxEvent): Promise<void> {
  const sql = neon(config.url);

  switch (event.eventType) {
    case 'sale.approved':
    case 'stock.imported': {
      const lines = (event.payload.lines ?? []) as { sku: string; delta: number }[];
      if (lines.length === 0) return;

      for (const line of lines) {
        if (!line.sku || !Number.isInteger(line.delta)) {
          throw new Error(`Malformed stock line in ${event.eventType}: ${JSON.stringify(line)}`);
        }

        // A relative delta, not an absolute value. Writing our count over theirs would
        // discard every sale their own till made since the last run — the "never overwrite
        // newer original-database data blindly" rule, expressed as arithmetic rather than
        // as a comparison we would have to get right.
        const guard =
          config.conflictPolicy === 'origin_wins' && line.delta < 0
            ? ` AND ${ident(config.inventoryQtyColumn)} >= ${Math.abs(line.delta)}`
            : '';

        const stamp = config.inventoryUpdatedColumn
          ? `, ${ident(config.inventoryUpdatedColumn)} = now()`
          : '';

        const result = await sql(
          `UPDATE ${ident(config.inventoryTable)}
              SET ${ident(config.inventoryQtyColumn)} = ${ident(config.inventoryQtyColumn)} + $2${stamp}
            WHERE ${ident(config.inventorySkuColumn)} = $1${guard}
            RETURNING ${ident(config.inventorySkuColumn)}`,
          [line.sku, line.delta]
        );

        if ((result as unknown[]).length === 0) {
          // Not silently skipped: either the SKU is unknown to the original or the guard
          // refused a deduction it could not cover. Both need a person.
          throw new Error(
            `Origin refused ${line.delta} for SKU ${line.sku} — unknown SKU, or insufficient stock under ${config.conflictPolicy}.`
          );
        }
      }
      return;
    }

    default:
      // Unknown event types are not an error — the log may carry things this version does
      // not sync — but they must not be marked synced either.
      throw new Error(`No origin mapping for event type "${event.eventType}".`);
  }
}
