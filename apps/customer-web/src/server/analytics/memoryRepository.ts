import 'server-only';
import { randomNonce } from '../crypto';
import { processSingleton } from '../singleton';
import type { AnalyticsRepository, EventQuery, StoreEvent } from './types';

/**
 * In-memory event log, matching the seam used by products and stores: callers depend on
 * `AnalyticsRepository`, never on this class, so moving to Postgres is a swap in
 * `index.ts` plus one table.
 *
 * READ THIS BEFORE THE PILOT. Unlike the product and store repositories — which are
 * seeded, read-mostly, and identical on every instance — this one accumulates state that
 * exists nowhere else. Two consequences, both disqualifying for a real supermarket run:
 *
 *   1. Serverless instances share no memory, so each instance aggregates only the events
 *      it happened to serve. The dashboard would show a fraction of the truth, varying
 *      per refresh.
 *   2. Nothing survives a redeploy or a cold start. A day's trading disappears.
 *
 * The Postgres shape this is standing in for:
 *
 *   CREATE TABLE store_events (
 *     id           text PRIMARY KEY,
 *     store_id     text NOT NULL REFERENCES stores(id),
 *     session_id   text NOT NULL,
 *     kind         text NOT NULL,
 *     occurred_at  timestamptz NOT NULL,
 *     payload      jsonb NOT NULL
 *   );
 *   CREATE INDEX ON store_events (store_id, occurred_at DESC);
 *
 * That index is the one that matters: every dashboard query is "this store, this window".
 */
const MAX_EVENTS_PER_STORE = 50_000;

class InMemoryAnalyticsRepository implements AnalyticsRepository {
  /** storeId -> events, append-ordered and therefore already sorted by `occurredAt`. */
  private readonly byStore = new Map<string, StoreEvent[]>();

  async record(event: Omit<StoreEvent, 'id'>): Promise<void> {
    const stored: StoreEvent = { ...event, id: `ev_${randomNonce(10)}` };

    const log = this.byStore.get(stored.storeId);
    if (!log) {
      this.byStore.set(stored.storeId, [stored]);
      return;
    }

    log.push(stored);

    // Bounded so a long-running dev server cannot grow without limit. Dropping the oldest
    // events is the right trade for a POC — recent data is what the dashboard shows — but
    // it is exactly the behaviour a real table must not have, since it would silently
    // truncate history the owner is trying to compare against.
    if (log.length > MAX_EVENTS_PER_STORE) {
      log.splice(0, log.length - MAX_EVENTS_PER_STORE);
    }
  }

  async query({ storeId, fromMs, toMs }: EventQuery): Promise<StoreEvent[]> {
    const log = this.byStore.get(storeId) ?? [];
    return log.filter((event) => event.occurredAt >= fromMs && event.occurredAt < toMs);
  }

  async earliestEventAt(storeId: string): Promise<number | null> {
    const log = this.byStore.get(storeId);
    return log && log.length > 0 ? log[0].occurredAt : null;
  }
}

/**
 * Process-pinned: the routes that write events and the route that reads them are separate
 * bundles, and without this they each get their own empty log. See `server/singleton.ts`.
 */
export const memoryAnalyticsRepository: AnalyticsRepository = processSingleton(
  'analytics.repository',
  () => new InMemoryAnalyticsRepository()
);
