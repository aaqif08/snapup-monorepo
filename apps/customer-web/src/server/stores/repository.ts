import 'server-only';
import { isDatabaseConfigured } from '../db/client';
import { isStoreApiConfigured } from '../storeApi/config';
import { apiStoreRepository } from './apiRepository';
import { memoryStoreRepository } from './memoryRepository';
import { postgresStoreRepository } from './postgresRepository';
import type { StoreRepository } from './types';

/**
 * Store registry selection. Same precedence as `products/repository.ts`.
 *
 * One thing to settle with the retailer for this repository specifically: the store record
 * carries `authorizedEgressCidrs`, which is a SnapUp *security control* rather than retail
 * data — it decides which networks can be granted a shopping session. Serving it from their
 * API means the retailer controls it. That is defensible, since it is their store and their
 * network, but it should be an explicit decision rather than a consequence of where the
 * field happened to live: whoever can write that list can authorise sessions.
 */
export const storeRepository: StoreRepository = isStoreApiConfigured()
  ? apiStoreRepository
  : isDatabaseConfigured()
    ? postgresStoreRepository
    : memoryStoreRepository;
