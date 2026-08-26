import 'server-only';
import { storeApiFind, storeApiRequest } from '../storeApi/client';
import { connectionForStoreId } from '../storeApi/routing';
import { PATHS, fromOrderRecord, toOrderRecord, type OrderDto } from '../storeApi/contract';
import type { OrderRecord, OrderRepository, PaymentConfirmation } from './types';

/**
 * The order book, written to the retailer's API.
 *
 * This is the arrangement's best outcome and its sharpest edge at the same time.
 *
 * The good part: a sale lands in the retailer's own system, which is where it has to be for
 * the owner to reconcile against their till at close. An order held only by SnapUp would
 * always have been a second set of books.
 *
 * The sharp edge: order creation is a **write over a network we do not control**, and a
 * timed-out write is genuinely ambiguous — the order may have been recorded and only the
 * response lost. `client.ts` therefore does not retry writes, because a retry could book
 * the same basket twice. What the customer sees instead is a failure to create the order,
 * which is the safe direction: an order that was not created cannot produce an exit token,
 * so nobody walks out on a basket the shop has no record of.
 */
class ApiOrderRepository implements OrderRepository {
  async create(draft: Omit<OrderRecord, 'id'>): Promise<OrderRecord> {
    // The id is assigned upstream rather than generated here. Their system is the authority
    // on the order record, and an id we invented would have to be reconciled against
    // whatever they assigned anyway.
    const dto = await storeApiRequest<OrderDto>(PATHS.orders, {
      method: 'POST',
      body: fromOrderRecord(draft),
      // The sale must land in the system belonging to the branch it happened in. Booking
      // it against the platform default would put a Thanjavur basket in whichever database
      // that points at, and the owner would reconcile against a till it never touched.
      connection: await connectionForStoreId(draft.storeId),
    });

    return toOrderRecord(dto);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    // No store to route by. Used only internally by the Postgres repository, which holds
    // every store in one database; on a per-branch deployment this reaches the platform
    // endpoint, which is why the session-scoped read below is the one the routes use.
    const dto = await storeApiFind<OrderDto>(PATHS.orderById(id));
    return dto ? toOrderRecord(dto) : null;
  }

  async findForSession(
    sessionId: string,
    orderId: string,
    storeId?: string
  ): Promise<OrderRecord | null> {
    const dto = await storeApiFind<OrderDto>(PATHS.orderById(orderId), {
      query: { session_id: sessionId },
      connection: storeId ? await connectionForStoreId(storeId) : undefined,
    });
    if (!dto) return null;

    const order = toOrderRecord(dto);

    // Ownership is re-checked here rather than trusted to the query parameter. If their API
    // ignores `session_id`, this is the line that stops one customer reading another
    // customer's basket by guessing an id — and it keeps a mismatched session
    // indistinguishable from a missing order, so the endpoint cannot be used to probe which
    // order ids exist. This property is too important to delegate.
    return order.sessionId === sessionId ? order : null;
  }

  async markPaid(
    id: string,
    confirmation: PaymentConfirmation,
    storeId?: string
  ): Promise<OrderRecord | null> {
    const dto = await storeApiFind<OrderDto>(PATHS.orderPayment(id), {
      method: 'POST',
      body: { confirmation },
      connection: storeId ? await connectionForStoreId(storeId) : undefined,
    });
    if (!dto) return null;

    const order = toOrderRecord(dto);

    // Idempotency now lives upstream, which is a property we can no longer enforce and must
    // therefore verify. If their endpoint is not idempotent, a customer tapping "I've paid"
    // twice books the sale twice and the owner's takings double-count — R8.13 and R9.13
    // cover exactly this, and they are the cases to run first against their API.
    return order;
  }

  /**
   * Not supported against a retailer order book.
   *
   * Staff verification is SnapUp's control over SnapUp's own exit gate; the retailer's API
   * has no concept of it and no column to hold it. Returning null would present to staff as
   * "no such code" and send them hunting for a typo that does not exist, so this throws —
   * a deployment that wants the exit gate keeps orders in SnapUp's database.
   */
  async findByVerificationCode(): Promise<OrderRecord | null> {
    throw new Error(
      'Staff payment verification requires SnapUp-owned orders. Leave SNAPUP_STORE_API_BASE ' +
        'unset so orders live in the SnapUp database, or record verification in the retailer system.'
    );
  }

  /** Not supported upstream: the retailer's order book has no SnapUp account column. */
  async listForUser(): Promise<OrderRecord[]> {
    return [];
  }

  /**
   * Not supported against a retailer order book: their schema has no column for a
   * SnapUp scale reading. Silently dropping it would be worse than refusing — staff
   * would see an approval that recorded nothing, and an override nobody can attribute
   * is the one outcome the audit column exists to prevent.
   */
  async recordWeightCheck(): Promise<void> {
    throw new Error(
      'The exit weight check requires SnapUp-owned orders. Leave SNAPUP_STORE_API_BASE ' +
        'unset so orders live in the SnapUp database.'
    );
  }

  async markVerified(): Promise<OrderRecord | null> {
    throw new Error(
      'Staff payment verification requires SnapUp-owned orders. See findByVerificationCode.'
    );
  }
}

export const apiOrderRepository: OrderRepository = new ApiOrderRepository();
