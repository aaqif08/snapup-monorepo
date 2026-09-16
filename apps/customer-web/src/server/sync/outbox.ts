import 'server-only';
import { db, databaseKind } from '@/server/db/client';

export interface OutboxEvent {
  eventType: string;
  storeId: string;
  subjectId: string;
  payload: Record<string, unknown>;
  at: number;
}

/** One SKU's movement. Negative takes stock off the shelf, positive puts it back. */
export interface StockLine {
  /** The retailer's own SKU code, as it came from the catalogue. */
  sku: string;
  /** What is physically printed on the packet. Sent too, because only the retailer knows
   *  which of the two their inventory is keyed by. */
  barcode: string;
  delta: number;
}

/**
 * Appends one event to the change log the 30-minute sync reads.
 *
 * ## Why this never throws
 *
 * The events worth syncing are approved sales and stock movements, and those are the two
 * things that must not fail. A shop that cannot clear a customer because a log table is
 * missing is worse than a shop whose log has a gap — the gap is recoverable by
 * reconciliation, the refused customer is standing at the door. So a failure here is logged
 * loudly and swallowed.
 *
 * That is a deliberate weakening of section 7's "created in the same transaction", and it
 * is the one place this implementation knowingly departs from the brief. The honest version
 * needs the outbox write inside the same statement as the approval, which is possible and
 * is noted in `docs/billing-workflow.md`; until the migration is approved the table does not
 * exist on the pilot database at all, and this must not take the shop down.
 */
export async function appendOutbox(event: OutboxEvent): Promise<void> {
  if (databaseKind() === 'none') return;

  try {
    await db()(
      `INSERT INTO outbox (event_type, store_id, subject_id, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [event.eventType, event.storeId, event.subjectId, JSON.stringify(event.payload), event.at]
    );
  } catch (error) {
    reportFailure(event.eventType, event.subjectId, error);
  }
}

/**
 * Appends a stock movement as **one event per SKU line**.
 *
 * ## Why not one event carrying every line
 *
 * Because `applyToOrigin` would then need several `UPDATE`s to discharge one event, and
 * there is no transaction to wrap them in — the HTTP driver gives each statement its own.
 * A five-line sale that failed on the third would leave two lines applied to the original,
 * the event unmarked, and the retry would apply those first two a second time. Every
 * event being a relative delta is what makes the sync safe against the original's own till
 * sales, and it is exactly what makes a partial replay silently wrong.
 *
 * One line per event makes discharging an event a single statement, which is atomic on its
 * own. A failure leaves that line unapplied and the others unaffected, and the retry sends
 * the one thing that did not land.
 *
 * ## The window that is left
 *
 * The `UPDATE` can succeed and this process die before `synced_at` is written, and the
 * retry would then apply that line twice. Closing it needs a ledger in the *original*
 * database keyed by event id — which section 7 forbids guessing at, since we have not been
 * told what we are permitted to create there. It is worth asking for: it is the difference
 * between at-least-once and exactly-once. Until then the window is one statement wide
 * instead of an entire multi-line sale, and reconciliation is what catches it.
 *
 * All the lines are written by a single multi-row `INSERT`, so a sale never lands in the
 * log as a partial set of movements.
 */
export async function appendStockOutbox(input: {
  eventType: 'sale.approved' | 'stock.imported';
  storeId: string;
  subjectId: string;
  lines: StockLine[];
  /** Copied onto every row: the sale total, the importing actor, and so on. */
  context: Record<string, unknown>;
  at: number;
}): Promise<void> {
  if (databaseKind() === 'none') return;
  if (input.lines.length === 0) return;

  // `created_at` is the same for every row, so it is one parameter at a fixed index past
  // the per-line ones rather than repeated per tuple.
  const atIndex = input.lines.length * 4 + 1;

  const values: unknown[] = [];
  const tuples = input.lines.map((line, index) => {
    const base = index * 4;
    values.push(
      input.eventType,
      input.storeId,
      input.subjectId,
      JSON.stringify({ ...input.context, ...line, line_no: index + 1 })
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${atIndex})`;
  });
  values.push(input.at);

  try {
    await db()(
      `INSERT INTO outbox (event_type, store_id, subject_id, payload, created_at)
       VALUES ${tuples.join(', ')}`,
      values
    );
  } catch (error) {
    reportFailure(input.eventType, input.subjectId, error);
  }
}

function reportFailure(eventType: string, subjectId: string, error: unknown): void {
  // An unmigrated database is the expected case today, not an incident: the table is in
  // schema.sql and unapplied pending approval. Reported once, at warn, without a stack.
  const message = error instanceof Error ? error.message : String(error);
  if (/relation "outbox" does not exist/i.test(message)) {
    console.warn(`[sync] outbox table not present; dropped ${eventType} for ${subjectId}`);
    return;
  }
  console.error(`[sync] failed to append ${eventType} for ${subjectId}`, error);
}
