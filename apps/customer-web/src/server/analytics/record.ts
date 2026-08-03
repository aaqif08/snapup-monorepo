import 'server-only';
import { analyticsRepository } from './memoryRepository';
import type { StoreEvent } from './types';

/**
 * Fire-and-forget event recording.
 *
 * Analytics must never be able to break shopping. A customer standing in an aisle with a
 * tin of beans does not care that the event log is unavailable, so every call here
 * swallows its own failures and returns immediately rather than making the scan path wait
 * on a write it does not need.
 *
 * The deliberate trade: recording is best-effort, so counts can under-report if a write
 * fails. That is the correct direction to be wrong in — a missing scan event costs an
 * insight, a failed scan costs a sale. When this moves to Postgres the same property
 * should be preserved by writing through a queue rather than by blocking the response.
 */
export function recordEvent(event: Omit<StoreEvent, 'id'>): void {
  void analyticsRepository.record(event).catch(() => {
    // Intentionally silent in the request path. Once there is a real logger, this is a
    // warn — never an error surfaced to the customer.
  });
}
