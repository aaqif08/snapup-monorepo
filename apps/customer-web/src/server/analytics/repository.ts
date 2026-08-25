import 'server-only';
import { isDatabaseConfigured } from '../db/client';
import { isStoreApiConfigured } from '../storeApi/config';
import { apiAnalyticsRepository } from './apiRepository';
import { memoryAnalyticsRepository } from './memoryRepository';
import { postgresAnalyticsRepository } from './postgresRepository';
import type { AnalyticsRepository } from './types';

/**
 * Event log selection. Same precedence as `products/repository.ts`.
 *
 * The in-memory log was the clearest case of a dashboard that could mislead rather than
 * merely lag: each serverless instance aggregated only the events it happened to serve, so
 * the owner saw a varying fraction of the truth on every refresh, with no indication the
 * number was partial. Either durable backend fixes that.
 *
 * Worth confirming with the retailer: this log is SnapUp's own telemetry rather than retail
 * data, so their API needs an endpoint that will accept it. If it will not, this is the one
 * repository that has nowhere to go under the API-key model, and the event log would need a
 * SnapUp-hosted store — which is what the Postgres implementation is still here for.
 */
export const analyticsRepository: AnalyticsRepository = isStoreApiConfigured()
  ? apiAnalyticsRepository
  : isDatabaseConfigured()
    ? postgresAnalyticsRepository
    : memoryAnalyticsRepository;
