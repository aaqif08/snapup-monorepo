import 'server-only';
import { randomNonce } from '../crypto';
import { processSingleton } from '../singleton';
import { isUpgrade, statusForConfirmation } from './paymentPolicy';
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

    // Idempotent, and one-directional. A customer who taps "I've paid" twice, or a PSP that
    // retries its webhook, must not produce two paid transitions — and a weaker
    // confirmation arriving after a stronger one must never downgrade what we already know.
    if (!isUpgrade(existing.payment.confirmation, confirmation)) return { ...existing };

    const status = statusForConfirmation(confirmation);
    const updated: OrderRecord = {
      ...existing,
      status,
      // Only stamped when the money is actually known to have arrived. An attestation is
      // not a payment time.
      paidAt: status === 'paid' ? (existing.paidAt ?? Date.now()) : existing.paidAt,
      payment: { ...existing.payment, confirmation },
    };
    this.byId.set(id, updated);
    return { ...updated };
  }

  async findByVerificationCode(storeId: string, code: string): Promise<OrderRecord | null> {
    for (const order of this.byId.values()) {
      if (order.storeId !== storeId) continue;
      if (order.verificationCode !== code) continue;
      // Only orders still waiting. Resolving a `paid` one would let staff verify the same
      // basket twice; an `abandoned` one belongs to nobody standing at the gate.
      if (order.status !== 'awaiting_payment' && order.status !== 'awaiting_verification') {
        continue;
      }
      return { ...order };
    }
    return null;
  }

  async listForUser(userId: string, limit: number): Promise<OrderRecord[]> {
    return [...this.byId.values()]
      .filter((order) => order.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((order) => ({ ...order }));
  }

  async markVerified(id: string, verifiedBy: string, at: number): Promise<OrderRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;
    if (existing.status !== 'awaiting_payment' && existing.status !== 'awaiting_verification') {
      return null;
    }

    const updated: OrderRecord = {
      ...existing,
      status: 'paid',
      paidAt: existing.paidAt ?? at,
      verifiedBy,
      verifiedAt: at,
      payment: { ...existing.payment, confirmation: 'staff_verified' },
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
export const memoryOrderRepository: OrderRepository = processSingleton(
  'orders.repository',
  () => new InMemoryOrderRepository()
);
