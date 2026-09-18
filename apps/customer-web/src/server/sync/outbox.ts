import 'server-only';
import { db, databaseKind } from '@/server/db/client';

export interface OutboxEvent {
  eventType: string;
  storeId: string;
  subjectId: string;
  payload: Record<string, unknown>;
  at: number;
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
 * Used for payment state changes only. Stock movements are not written here: an approved
 * sale queues its lines inside the same statement that moves the stock (see `approveExit`),
 * and an import queues its inside the importer. Those are the events that must not be
 * lost, and neither passes through a function that swallows failures.
 *
 * ## One SKU per event
 *
 * Every stock event carries a single line, so discharging it is one statement — the only
 * thing that is atomic on this driver. A multi-line event failing part-way would leave some
 * lines applied and re-apply them on retry. What remains is a one-statement window: the
 * origin's UPDATE lands and this process dies before `synced_at` is written. Closing it
 * needs a ledger in the *original* database keyed by event id, which section 7 says to ask
 * for rather than guess.
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
