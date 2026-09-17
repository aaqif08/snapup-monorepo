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
  private billsIssued = 0;

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
      // Not abandoned, not yet cleared. A gateway payment is `paid` before the desk has
      // seen it, so payment status cannot be the filter; `exitApprovedAt` is what stops a
      // basket being verified twice.
      if (order.status === 'abandoned' || order.exitApprovedAt !== null) continue;
      return { ...order };
    }
    return null;
  }

  async approveExit(orderId: string, staffId: string, at: number): Promise<OrderRecord | null> {
    const order = this.byId.get(orderId);
    // Already authorised: a replayed exit QR must not succeed a second time, and must
    // not finalise inventory again.
    if (!order || order.exitApprovedAt !== null) return null;

    order.exitApprovedAt = at;
    order.inventoryFinalisedAt = at;
    order.verifiedBy ??= staffId;
    // Same shape as the database mints, so a bill looks the same whichever engine made
    // it; uniqueness here is per process, which is all an in-memory book can promise.
    this.billsIssued += 1;
    order.billNumber ??= `SU${istDateStamp(at)}-${String(this.billsIssued).padStart(7, '0')}`;
    return { ...order };
  }

  async denyExit(
    orderId: string,
    staffId: string,
    reason: string,
    at: number
  ): Promise<OrderRecord | null> {
    const order = this.byId.get(orderId);
    // A basket already cleared to leave cannot be retrospectively refused.
    if (!order || order.exitApprovedAt !== null) return null;

    order.exitDeniedAt = at;
    order.exitDeniedBy = staffId;
    order.exitDenialReason = reason;
    return { ...order };
  }

  async recordWeightCheck(input: {
    orderId: string;
    observedGrams: number;
    checkedBy: string;
    at: number;
    overrodeBy: string | null;
  }): Promise<void> {
    const order = this.byId.get(input.orderId);
    if (!order) return;
    order.observedWeightGrams = input.observedGrams;
    order.weightCheckedBy = input.checkedBy;
    order.weightCheckedAt = input.at;
    order.weightOverrideBy = input.overrodeBy;
  }

  async listForUser(userId: string, limit: number): Promise<OrderRecord[]> {
    return [...this.byId.values()]
      .filter((order) => order.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((order) => ({ ...order }));
  }

  async findClearedByVerificationCode(storeId: string, code: string): Promise<OrderRecord | null> {
    let latest: OrderRecord | null = null;
    for (const order of this.byId.values()) {
      if (order.storeId !== storeId || order.verificationCode !== code) continue;
      if (order.exitApprovedAt === null) continue;
      if (!latest || order.exitApprovedAt > (latest.exitApprovedAt ?? 0)) latest = order;
    }
    return latest ? { ...latest } : null;
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

/** `yymmdd` in IST, matching the database's `to_char(timezone('Asia/Kolkata', now()), 'YYMMDD')`. */
function istDateStamp(epochMs: number): string {
  const ist = new Date(epochMs + 5.5 * 60 * 60 * 1000);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}
