import 'server-only';
import { db, databaseKind } from '@/server/db/client';
import type { WebhookEvent } from './gateway';
import { appendOutbox } from '@/server/sync/outbox';

export type RecordOutcome = 'recorded' | 'duplicate' | 'unknown_order' | 'amount_mismatch';

/**
 * Writes a verified gateway outcome onto the order.
 *
 * ## Idempotency lives in the database, not here
 *
 * Section 9E asks that a duplicate webhook, a page refresh and a staff double-click all
 * produce one bill and one deduction. This does not check-then-write: it writes with the
 * gateway's payment id and lets the unique index on `(gateway, gateway_payment_id)` refuse
 * the second one. Two webhook deliveries racing on two instances would both pass a check
 * and both write; only the index actually holds.
 *
 * ## The amount is re-checked against our own total
 *
 * A gateway reporting a smaller amount than the basket is either a partial capture or a
 * tampered notification, and neither should quietly mark a basket settled. The order is
 * left alone and the mismatch is returned for someone to look at.
 */
export async function recordGatewayOutcome(
  gatewayName: string,
  event: WebhookEvent
): Promise<RecordOutcome> {
  if (databaseKind() === 'none') return 'unknown_order';

  const sql = db();
  const now = Date.now();

  const [order] = (await sql(
    `SELECT id, store_id, total_paise, gateway_payment_id FROM orders WHERE id = $1`,
    [event.orderId]
  )) as { id: string; store_id: string; total_paise: number; gateway_payment_id: string | null }[];

  if (!order) return 'unknown_order';
  if (order.gateway_payment_id === event.gatewayPaymentId) return 'duplicate';

  if (event.outcome === 'captured' && event.amountPaise !== order.total_paise) {
    await sql(
      `UPDATE orders SET failure_reason = $2 WHERE id = $1 AND failure_reason IS NULL`,
      [
        order.id,
        `Gateway reported ${event.amountPaise} paise against a basket of ${order.total_paise}.`,
      ]
    );
    return 'amount_mismatch';
  }

  const state =
    event.outcome === 'captured'
      ? 'PAYMENT_RECEIVED_PENDING_STAFF'
      : event.outcome === 'refunded'
        ? 'REFUNDED'
        : 'DECLINED_OR_CANCELLED';

  // `gateway_payment_id IS NULL` is the idempotency guard, backed by the unique index: the
  // second delivery matches no row and changes nothing.
  //
  // `confirmation` becomes `psp_webhook`, which `mayExit` already ranks above
  // `customer_attested` — a payment the gateway vouches for is stronger evidence than the
  // customer's word, and the exit desk treats it accordingly. It still does not open the
  // gate on its own; staff approval is what moves stock.
  const updated = (await sql(
    `UPDATE orders
        SET payment_state       = $2,
            gateway             = $3,
            gateway_payment_id  = $4,
            status              = CASE WHEN $2 = 'PAYMENT_RECEIVED_PENDING_STAFF' THEN 'paid' ELSE status END,
            paid_at             = CASE WHEN $2 = 'PAYMENT_RECEIVED_PENDING_STAFF' THEN COALESCE(paid_at, $5) ELSE paid_at END,
            confirmation        = CASE WHEN $2 = 'PAYMENT_RECEIVED_PENDING_STAFF' THEN 'psp_webhook' ELSE confirmation END,
            failure_reason      = $6
      WHERE id = $1
        AND gateway_payment_id IS NULL
      RETURNING id`,
    [order.id, state, gatewayName, event.gatewayPaymentId, now, event.failureReason ?? null]
  )) as { id: string }[];

  if (updated.length === 0) return 'duplicate';

  await appendOutbox({
    eventType: `payment.${event.outcome}`,
    storeId: order.store_id,
    subjectId: order.id,
    payload: {
      gateway: gatewayName,
      gateway_payment_id: event.gatewayPaymentId,
      amount_paise: event.amountPaise,
      state,
    },
    at: now,
  });

  return 'recorded';
}
