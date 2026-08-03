import 'server-only';
import { randomNonce } from '../crypto';
import { processSingleton } from '../singleton';
import type { OrderRecord, OrderRepository, PaymentConfirmation } from './types';

/**
 * In-memory order book.
 *
 * Same seam as the other repositories, and the same warning as the event log: orders are
 * state that exists nowhere else, so this implementation is not pilot-safe. A serverless
 * instance that did not serve the create call cannot answer the confirm call, and a
 * redeploy loses the day's trading.
 *
 * The table this stands in for:
 *
 *   CREATE TABLE orders (
 *     id            text PRIMARY KEY,
 *     store_id      text NOT NULL REFERENCES stores(id),
 *     session_id    text NOT NULL,
 *     status        text NOT NULL,
 *     total_paise   integer NOT NULL,
 *     ...
 *     created_at    timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX ON orders (session_id);
 *   CREATE INDEX ON orders (store_id, created_at DESC);
 *
 * Order lines belong in their own table with a foreign key, not a jsonb blob: the buyer's
 * "how many units of X did we sell" query is the whole point of collecting them.
 */
class InMemoryOrderRepository implements OrderRepository {
  private readonly byId = new Map<string, OrderRecord>();

  async create(draft: Omit<OrderRecord, 'id'>): Promise<OrderRecord> {
    const order: OrderRecord = { ...draft, id: `ord_${randomNonce(9)}` };
    this.byId.set(order.id, order);
    return { ...order };
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async findForSession(sessionId: string, orderId: string): Promise<OrderRecord | null> {
    const found = this.byId.get(orderId);
    // Ownership is checked here rather than by the caller, so there is no route that can
    // forget to do it and expose another customer's basket by guessing an id.
    return found && found.sessionId === sessionId ? { ...found } : null;
  }

  async markPaid(id: string, confirmation: PaymentConfirmation): Promise<OrderRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    // Idempotent: a customer who taps "I've paid" twice, or a PSP that retries its webhook,
    // must not produce two paid transitions — and a weaker confirmation arriving after a
    // stronger one must never downgrade what we already know.
    if (existing.status === 'paid') return { ...existing };

    const updated: OrderRecord = {
      ...existing,
      status: 'paid',
      paidAt: Date.now(),
      payment: { ...existing.payment, confirmation },
    };
    this.byId.set(id, updated);
    return { ...updated };
  }
}

/**
 * Process-pinned. `POST /api/orders` and `POST /api/orders/[id]/payment` are separate
 * route bundles, so without this the payment route looks up the order in a different,
 * empty map and returns 404. See `server/singleton.ts`.
 */
export const orderRepository: OrderRepository = processSingleton(
  'orders.repository',
  () => new InMemoryOrderRepository()
);
