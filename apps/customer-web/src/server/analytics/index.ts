import 'server-only';

/**
 * Same seam as products and stores: callers depend on the interface, and `repository.ts`
 * picks the implementation. See the warning in `memoryRepository.ts` — that one is not
 * pilot-safe, which is why a pilot must set `DATABASE_URL`.
 */
export { analyticsRepository } from './repository';
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
