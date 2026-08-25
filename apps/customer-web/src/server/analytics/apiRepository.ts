import 'server-only';
import { storeApiRequest } from '../storeApi/client';
import { connectionForStoreId } from '../storeApi/routing';
import { PATHS, fromStoreEvent, toStoreEvent, type EventDto } from '../storeApi/contract';
import type { AnalyticsRepository, EventQuery, StoreEvent } from './types';

/**
 * The store event log, written to the retailer's API.
 *
 * One behaviour here differs from every other repository, and it is deliberate: **recording
 * an event must never fail a customer's request.**
 *
 * Events are recorded on the side of operations that matter — a session starting, a barcode
 * being scanned, an order being paid. If the retailer's API is briefly unavailable, the
 * right outcome is a gap in the analytics, not a shopper who cannot scan a tin of beans.
 * The dashboard is a reporting surface; the scanner is the product. So `record()` swallows
 * upstream failures after logging them, while `query()` propagates them — because a
 * dashboard that silently renders a partial day as though it were complete is the failure
 * mode the whole read model was designed to avoid.
 */
class ApiAnalyticsRepository implements AnalyticsRepository {
  async record(event: Omit<StoreEvent, 'id'>): Promise<void> {
    try {
      await storeApiRequest<void>(PATHS.events, {
        method: 'POST',
        body: fromStoreEvent(event),
        connection: await connectionForStoreId(event.storeId),
      });
    } catch (error) {
      // Logged rather than thrown. This is the one place in the system where losing data is
      // preferable to failing the request that produced it — and it is logged loudly
      // because a persistent gap here means the owner's dashboard is quietly wrong.
      console.error(
        `[analytics] dropped a ${event.kind} event for ${event.storeId}: ${(error as Error).message}`
      );
    }
  }

  async query({ storeId, fromMs, toMs }: EventQuery): Promise<StoreEvent[]> {
    const dtos = await storeApiRequest<EventDto[]>(PATHS.events, {
      query: { store_id: storeId, from: fromMs, to: toMs },
      connection: await connectionForStoreId(storeId),
    });

    return (dtos ?? [])
      .map(toStoreEvent)
      // Scoping and windowing are re-applied rather than trusted. A store owner must never
      // see a competitor's trading figures through their own console, and that guarantee
      // cannot rest on a query parameter being honoured by someone else's code.
      //
      // The window is half-open — `>= from`, `< to` — matching the other implementations. An
      // inclusive upper bound would double-count an event landing exactly on midnight in
      // both "today" and "yesterday".
      .filter(
        (event) =>
          event.storeId === storeId && event.occurredAt >= fromMs && event.occurredAt < toMs
      )
      // Ascending, so the aggregate can pair session starts with session ends in one pass.
      .sort((a, b) => a.occurredAt - b.occurredAt);
  }

  async earliestEventAt(storeId: string): Promise<number | null> {
    const response = await storeApiRequest<{ earliest_at: number | string | null } | null>(
      PATHS.eventsEarliest,
      { query: { store_id: storeId }, connection: await connectionForStoreId(storeId) }
    );

    const earliest = response?.earliest_at;
    if (earliest === null || earliest === undefined) return null;

    const parsed = typeof earliest === 'string' ? Number(earliest) : earliest;

    // Null rather than 0 for a store that has never traded. The dashboard renders an
    // unknown as an em dash and a zero as a zero, and those mean opposite things to an
    // owner deciding staffing.
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export const apiAnalyticsRepository: AnalyticsRepository = new ApiAnalyticsRepository();
