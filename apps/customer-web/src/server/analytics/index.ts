import 'server-only';

/**
 * Same seam as products and stores: callers depend on the interface, so the move to
 * Postgres is a swap of the export below. See the warning in `memoryRepository.ts` — this
 * is the one repository whose in-memory implementation is not pilot-safe.
 */
export { analyticsRepository } from './memoryRepository';
export { recordEvent } from './record';
export { aggregate } from './aggregate';
export type {
  StoreAnalytics,
  TopProduct,
  AisleTraffic,
  HourBucket,
  DayBucket,
  MissedScan,
} from './aggregate';
export type {
  StoreEvent,
  StoreEventKind,
  OrderEventLine,
  EventQuery,
  AnalyticsRepository,
} from './types';
