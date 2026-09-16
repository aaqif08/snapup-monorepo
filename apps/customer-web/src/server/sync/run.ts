import 'server-only';
import { randomUUID } from 'crypto';
import { db, databaseKind } from '@/server/db/client';
import {
  applyToOrigin,
  originConfig,
  readOriginQuantities,
  OriginNotConfiguredError,
  type OriginConfig,
} from './origin';
import type { OutboxEvent } from './outbox';

export interface Mismatch {
  sku: string;
  ours: number;
  theirs: number | null;
}

export interface SyncResult {
  runId: string;
  sent: number;
  /** Discharged with nothing to send — a payment state under an inventory-only mapping. */
  skipped: number;
  failed: number;
  outcome: 'ok' | 'partial' | 'not_configured' | 'failed';
  detail?: string;
  reconciliation?: { checked: number; mismatched: Mismatch[] };
}

/** How many events one run will attempt. Bounded so a backlog cannot hold a request open. */
const BATCH = 200;
/** Given up on after this many attempts, and left for a person. */
const MAX_ATTEMPTS = 8;
/**
 * How long a claim is honoured before another run may take the event back.
 *
 * Longer than any run can plausibly take, because reclaiming an event that is still in
 * flight is the duplicate this whole mechanism exists to prevent. Ten minutes against a
 * thirty-minute cadence leaves a crashed run's work to the next run rather than the one
 * after it.
 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * One pass of the 30-minute synchronisation.
 *
 * ## Overlapping runs cannot send the same event
 *
 * Events are **claimed** by writing the run id onto the row, in one statement that both
 * selects and marks them. `SELECT … FOR UPDATE SKIP LOCKED` on its own does not do this
 * job here and used to be relied on to: the HTTP driver has no session, so each statement
 * is its own transaction and the lock died with the SELECT that took it. Two runs — a cron
 * firing while a manual run is in flight, or a retry after a timeout — would both read the
 * same rows and both send them, and since every event is a relative delta the original
 * would apply each one twice.
 *
 * Inside a single statement `SKIP LOCKED` does hold, which is why the claim is written by
 * the same `UPDATE` that chooses the rows. A claim outlives its statement; a lock does not.
 *
 * ## Marked synced only after confirmation
 *
 * `applyToOrigin` returns only when the original database has acknowledged the write, and
 * only then is `synced_at` set. The reverse order is the classic way to lose a sale: the
 * event is marked done, the write is rolled back, and nothing ever looks at it again.
 */
export async function runSync(): Promise<SyncResult> {
  const runId = `sync_${randomUUID().slice(0, 12)}`;
  const startedAt = Date.now();

  if (databaseKind() === 'none') {
    return {
      runId,
      sent: 0,
      skipped: 0,
      failed: 0,
      outcome: 'not_configured',
      detail: 'No database configured.',
    };
  }

  let config;
  try {
    config = originConfig();
  } catch (error) {
    if (error instanceof OriginNotConfiguredError) {
      return { runId, sent: 0, skipped: 0, failed: 0, outcome: 'not_configured', detail: error.message };
    }
    throw error;
  }

  if (!config) {
    return {
      runId,
      sent: 0,
      skipped: 0,
      failed: 0,
      outcome: 'not_configured',
      detail:
        'SNAPUP_ORIGIN_DATABASE_URL is not set. The outbox keeps accumulating; nothing is lost.',
    };
  }

  const sql = db();
  await sql(`INSERT INTO sync_runs (id, started_at) VALUES ($1, $2)`, [runId, startedAt]);

  // One statement: choose the oldest unclaimed events and take them. `attempts` is
  // incremented here rather than on failure, so a run that dies mid-flight still counts
  // against the retry budget and a permanently poisoned event cannot be retried for ever
  // by successive crashes.
  const claimed = (await sql(
    `UPDATE outbox
        SET claimed_at = $2, claimed_by = $3, attempts = attempts + 1
      WHERE id IN (
        SELECT id
          FROM outbox
         WHERE synced_at IS NULL
           AND skipped_at IS NULL
           AND attempts < $4
           AND (claimed_at IS NULL OR claimed_at < $5)
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_type, store_id, subject_id, payload, created_at`,
    [BATCH, startedAt, runId, MAX_ATTEMPTS, startedAt - CLAIM_TTL_MS]
  )) as {
    id: string;
    event_type: string;
    store_id: string;
    subject_id: string;
    payload: Record<string, unknown>;
    created_at: number;
  }[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  /** SKUs this run moved, for the reconciliation pass below. */
  const touched = new Set<string>();

  for (const row of claimed) {
    const event: OutboxEvent = {
      eventType: row.event_type,
      storeId: row.store_id,
      subjectId: row.subject_id,
      payload: row.payload,
      at: Number(row.created_at),
    };

    try {
      const disposition = await applyToOrigin(config, event);

      if (disposition.applied) {
        await sql(`UPDATE outbox SET synced_at = $2, last_error = NULL WHERE id = $1`, [
          row.id,
          Date.now(),
        ]);
        touched.add(disposition.sku);
        sent += 1;
      } else {
        // Discharged without a write. Recorded as its own thing rather than as a send, so
        // the log never claims the original was told something it was not.
        await sql(
          `UPDATE outbox SET skipped_at = $2, skipped_reason = $3, last_error = NULL WHERE id = $1`,
          [row.id, Date.now(), disposition.reason]
        );
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      // The claim is released so the next run picks this up rather than waiting out the
      // TTL. `attempts` was already charged at claim time and is left alone.
      await sql(`UPDATE outbox SET claimed_at = NULL, claimed_by = NULL, last_error = $2 WHERE id = $1`, [
        row.id,
        message.slice(0, 500),
      ]);
      console.error(`[sync] ${row.event_type} ${row.subject_id} failed: ${message}`);
    }
  }

  const reconciliation = await reconcile(config, touched);
  const outcome = failed === 0 ? 'ok' : sent > 0 || skipped > 0 ? 'partial' : 'failed';

  await sql(
    `UPDATE sync_runs
        SET finished_at = $2, events_sent = $3, events_failed = $4, events_skipped = $5,
            outcome = $6, reconciliation = $7::jsonb
      WHERE id = $1`,
    [runId, Date.now(), sent, failed, skipped, outcome, JSON.stringify(reconciliation)]
  );

  return { runId, sent, skipped, failed, outcome, reconciliation };
}

/**
 * Section 7's reconciliation: compare the SKUs this run moved and report what disagrees.
 *
 * Scoped to what the run touched rather than sweeping the whole catalogue. A full sweep of
 * 547 SKUs against someone else's production database every half hour is load they did not
 * agree to, and the rows that just changed are the ones where a fault would be new.
 *
 * A mismatch is **reported, never corrected**. Their till selling something we have not
 * seen is a legitimate difference under `origin_wins`, and a job that "fixed" it would be
 * overwriting newer original data — precisely what section 7 forbids.
 *
 * Its own failure is not the run's failure. Every event above has already been applied and
 * acknowledged; losing the comparison afterwards must not make a successful sync look
 * broken.
 */
async function reconcile(
  config: OriginConfig,
  touched: Set<string>
): Promise<{ checked: number; mismatched: Mismatch[] } | undefined> {
  if (touched.size === 0) return { checked: 0, mismatched: [] };

  const skus = [...touched];

  try {
    const sql = db();
    const ours = (await sql(
      `SELECT internal_sku, barcode, stock_quantity
         FROM products
        WHERE internal_sku = ANY($1) OR barcode = ANY($1)`,
      [skus]
    )) as { internal_sku: string; barcode: string; stock_quantity: number | string }[];

    // Keyed by both identifiers, because the origin mapping decides which of the two the
    // event carried and this has to match whichever it was.
    const mine = new Map<string, number>();
    for (const row of ours) {
      const qty = Number(row.stock_quantity);
      if (row.internal_sku) mine.set(row.internal_sku, qty);
      if (row.barcode) mine.set(row.barcode, qty);
    }

    const theirs = await readOriginQuantities(config, skus);

    const mismatched: Mismatch[] = [];
    for (const sku of skus) {
      const ourQty = mine.get(sku);
      if (ourQty === undefined) continue;
      const theirQty = theirs.has(sku) ? theirs.get(sku)! : null;
      if (theirQty !== ourQty) mismatched.push({ sku, ours: ourQty, theirs: theirQty });
    }

    if (mismatched.length > 0) {
      console.warn(
        `[sync] reconciliation: ${mismatched.length} of ${skus.length} SKU(s) disagree with the original`
      );
    }

    return { checked: skus.length, mismatched };
  } catch (error) {
    console.error('[sync] reconciliation could not be completed', error);
    return undefined;
  }
}
