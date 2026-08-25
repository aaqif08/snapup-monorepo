import 'server-only';
import { isDatabaseConfigured } from '../db/client';
import { isStoreApiConfigured } from '../storeApi/config';
import { apiOrderRepository } from './apiRepository';
import { memoryOrderRepository } from './memoryRepository';
import { postgresOrderRepository } from './postgresRepository';
import type { OrderRepository } from './types';

/**
 * Order book selection. Same precedence as `products/repository.ts`.
 *
 * This is the one where the choice has money attached. Writing orders through the
 * retailer's API is the right answer for reconciliation — the sale lands in the system the
 * owner balances their till against, rather than in a second set of books held by SnapUp.
 *
 * It also moves payment idempotency out of our control. `markPaid` was idempotent by
 * construction in both other implementations; upstream it is a property to be verified
 * rather than guaranteed. R8.13 and R9.13 are the cases that catch it if it is not.
 */
export const orderRepository: OrderRepository = isStoreApiConfigured()
  ? apiOrderRepository
  : isDatabaseConfigured()
    ? postgresOrderRepository
    : memoryOrderRepository;
