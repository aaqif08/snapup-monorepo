import 'server-only';
import { isDatabaseConfigured } from '../db/client';
import { isStoreApiConfigured } from '../storeApi/config';
import { apiProductRepository } from './apiRepository';
import { memoryProductRepository } from './memoryRepository';
import { postgresProductRepository } from './postgresRepository';
import type { ProductRepository } from './types';

/**
 * Which catalogue the app is actually running on.
 *
 * Three backends, one interface, and the choice made in one readable place. The seam
 * Requirement 4 described is this line — no route, component, projection or auth check
 * knows which one it got, because every one of them depends on `ProductRepository`.
 *
 * Order of precedence, and why:
 *
 *   1. **The retailer's API** (`SNAPUP_STORE_API_*`). The deployment model actually agreed:
 *      the supermarket hosts the database, only the store owner can reach it, and SnapUp is
 *      given a key. It wins when configured because it is the authority — their system
 *      knows what is on the shelf and what it costs.
 *   2. **Postgres** (`DATABASE_URL`). For data SnapUp owns in deployments where it owns
 *      any, and the fallback if the API arrangement changes.
 *   3. **In memory.** The seeded catalogue. Not pilot-safe, and kept because it is what
 *      makes the 88-case validation harness runnable with no database and no upstream — it
 *      carries the seed data those cases assert exact prices against.
 */
export const productRepository: ProductRepository = isStoreApiConfigured()
  ? apiProductRepository
  : isDatabaseConfigured()
    ? postgresProductRepository
    : memoryProductRepository;
