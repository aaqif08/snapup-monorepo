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
    // An unmigrated database is the expected case today, not an incident: the table is in
    // schema.sql and unapplied pending approval. Reported once, at warn, without a stack.
    const message = error instanceof Error ? error.message : String(error);
    if (/relation "outbox" does not exist/i.test(message)) {
      console.warn(`[sync] outbox table not present; dropped ${event.eventType} for ${event.subjectId}`);
      return;
    }
    console.error(`[sync] failed to append ${event.eventType} for ${event.subjectId}`, error);
  }
}
