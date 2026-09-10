import 'server-only';
import { randomUUID } from 'crypto';
import { db, databaseKind } from '@/server/db/client';
import { applyToOrigin, originConfig, OriginNotConfiguredError } from './origin';
import type { OutboxEvent } from './outbox';

export interface SyncResult {
  runId: string;
  sent: number;
  failed: number;
  outcome: 'ok' | 'partial' | 'not_configured' | 'failed';
  detail?: string;
  reconciliation?: { checked: number; mismatched: { sku: string; ours: number; theirs: number }[] };
}

/** How many events one run will attempt. Bounded so a backlog cannot hold a request open. */
const BATCH = 200;
/** Given up on after this many attempts, and left for a person. */
const MAX_ATTEMPTS = 8;

/**
 * One pass of the 30-minute synchronisation.
 *
 * ## Safe to run twice at once
 *
 * The claim uses `FOR UPDATE SKIP LOCKED`, so two overlapping runs — a cron firing while a
 * manual run is in flight, or a retry after a timeout — divide the backlog instead of both
 * sending the same events. Section 7 asks for idempotency; this is the half of it that
 * belongs to us, and the other half is that every event we send is a relative delta the
 * original applies once.
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
    return { runId, sent: 0, failed: 0, outcome: 'not_configured', detail: 'No database configured.' };
  }

  let config;
  try {
    config = originConfig();
  } catch (error) {
    if (error instanceof OriginNotConfiguredError) {
      return { runId, sent: 0, failed: 0, outcome: 'not_configured', detail: error.message };
    }
    throw error;
  }

  if (!config) {
    return {
      runId,
      sent: 0,
      failed: 0,
      outcome: 'not_configured',
      detail:
        'SNAPUP_ORIGIN_DATABASE_URL is not set. The outbox keeps accumulating; nothing is lost.',
    };
  }

  const sql = db();
  await sql(`INSERT INTO sync_runs (id, started_at) VALUES ($1, $2)`, [runId, startedAt]);

  const pending = (await sql(
    `SELECT id, event_type, store_id, subject_id, payload, created_at, attempts
       FROM outbox
      WHERE synced_at IS NULL
        AND attempts < $2
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [BATCH, MAX_ATTEMPTS]
  )) as {
    id: string;
    event_type: string;
    store_id: string;
    subject_id: string;
    payload: Record<string, unknown>;
    created_at: number;
  }[];

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    const event: OutboxEvent = {
      eventType: row.event_type,
      storeId: row.store_id,
      subjectId: row.subject_id,
      payload: row.payload,
      at: Number(row.created_at),
    };

    try {
      await applyToOrigin(config, event);
      await sql(`UPDATE outbox SET synced_at = $2, last_error = NULL WHERE id = $1`, [
        row.id,
        Date.now(),
      ]);
      sent += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      // Attempts are counted even on transient failures, so a permanently poisoned event
      // eventually stops being retried and starts being visible instead.
      await sql(
        `UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [row.id, message.slice(0, 500)]
      );
      console.error(`[sync] ${row.event_type} ${row.subject_id} failed: ${message}`);
    }
  }

  const outcome = failed === 0 ? 'ok' : sent > 0 ? 'partial' : 'failed';

  await sql(
    `UPDATE sync_runs
        SET finished_at = $2, events_sent = $3, events_failed = $4, outcome = $5
      WHERE id = $1`,
    [runId, Date.now(), sent, failed, outcome]
  );

  return { runId, sent, failed, outcome };
}
