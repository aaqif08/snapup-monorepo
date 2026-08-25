import 'server-only';
import { randomNonce } from '../crypto';
import { db, toEpochMs } from '../db/client';
import type { AnalyticsRepository, EventQuery, StoreEvent } from './types';

/**
 * The store event log, durable.
 *
 * The in-memory version carried a `MAX_EVENTS_PER_STORE` cap that dropped the oldest events
 * once the log grew past 50,000. That was the right trade for a dev server which would
 * otherwise grow without limit, and it is deliberately **not** reproduced here: silently
 * truncating history is precisely the behaviour a real table must not have, since the owner
 * comparing this month against last month would be shown a quietly shortened past.
 *
 * The bound that replaces it is retention, not truncation — rolling events older than a
 * chosen window into daily summaries. That is not built. Until it is, the table grows with
 * trading volume, which at pilot scale is a few thousand rows a day and entirely fine.
 */

type EventRow = Record<string, unknown>;

/** The kind-specific fields, which live in `payload` rather than in their own columns. */
type EventPayload = Omit<StoreEvent, 'id' | 'storeId' | 'sessionId' | 'kind' | 'occurredAt'>;

function toEvent(row: EventRow): StoreEvent {
  const payload = (row.payload as EventPayload | null) ?? {};

  return {
    id: row.id as string,
    storeId: row.store_id as string,
    sessionId: row.session_id as string,
    kind: row.kind as StoreEvent['kind'],
    occurredAt: toEpochMs(row.occurred_at),
    ...payload,
  };
}

class PostgresAnalyticsRepository implements AnalyticsRepository {
  async record(event: Omit<StoreEvent, 'id'>): Promise<void> {
    const { storeId, sessionId, kind, occurredAt, ...payload } = event;

    const sql = db();
    await sql`
      INSERT INTO store_events (id, store_id, session_id, kind, occurred_at, payload)
      VALUES (
        ${`ev_${randomNonce(10)}`},
        ${storeId},
        ${sessionId},
        ${kind},
        ${occurredAt},
        ${JSON.stringify(payload)}::jsonb
      )
    `;
  }

  async query({ storeId, fromMs, toMs }: EventQuery): Promise<StoreEvent[]> {
    const sql = db();

    // Ascending, so the aggregate can pair session starts with session ends in one pass.
    // `seq` breaks ties within a millisecond and preserves append order — see the schema.
    //
    // The window is half-open, `>= from` and `< to`, matching the in-memory filter exactly.
    // An inclusive upper bound would double-count an event landing precisely on midnight
    // in both "today" and "yesterday".
    const rows = (await sql`
      SELECT * FROM store_events
      WHERE store_id = ${storeId}
        AND occurred_at >= ${fromMs}
        AND occurred_at < ${toMs}
      ORDER BY occurred_at, seq
    `) as EventRow[];

    return rows.map(toEvent);
  }

  async earliestEventAt(storeId: string): Promise<number | null> {
    const sql = db();
    const rows = (await sql`
      SELECT MIN(occurred_at) AS earliest FROM store_events WHERE store_id = ${storeId}
    `) as { earliest: string | number | null }[];

    const earliest = rows[0]?.earliest;

    // Null rather than 0 when the store has never traded. The dashboard renders an unknown
    // as an em dash and a zero as a zero, and those mean opposite things to an owner
    // deciding staffing.
    return earliest === null || earliest === undefined ? null : toEpochMs(earliest);
  }
}

export const postgresAnalyticsRepository: AnalyticsRepository = new PostgresAnalyticsRepository();
