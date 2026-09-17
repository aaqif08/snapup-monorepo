import 'server-only';
import { db, databaseKind } from '@/server/db/client';
import { activeGateway } from './gateway';

export type InitiateOutcome =
  | { ok: true; gateway: string; gatewayOrderId: string; client: Record<string, unknown> }
  | { ok: false; reason: 'gateway_not_configured' | 'no_database' | 'unknown_order' | 'already_paid' };

/**
 * Opens a payment on the gateway for an order, once.
 *
 * ## One gateway order per basket
 *
 * The idempotency key is derived from our order id, so the same basket asked twice — a
 * refresh, a closed widget, a second tap — is the same key both times, and the gateway
 * dedupes on it. The write to our own row is then guarded with `gateway_order_id IS NULL`,
 * so two requests racing on two instances cannot both record a different gateway order: the
 * second sees no row updated, re-reads, and hands back what the first stored.
 *
 * ## What this does not do
 *
 * Mark anything paid. Nothing that happens on the customer's phone can. The order moves to
 * `PAYMENT_PENDING` here and to `PAYMENT_RECEIVED_PENDING_STAFF` only when the gateway's
 * signed webhook arrives — section 2's rule, "never trust a payment-success value sent
 * directly by the customer app", enforced by there being no route that would accept one.
 */
export async function initiateGatewayPayment(
  orderId: string,
  storeName: string
): Promise<InitiateOutcome> {
  const gateway = await activeGateway();
  if (!gateway) return { ok: false, reason: 'gateway_not_configured' };

  // The gateway columns live on the order row. Without a database there is nowhere to
  // record which gateway order belongs to which basket, and a webhook would have nothing
  // to match against.
  if (databaseKind() === 'none') return { ok: false, reason: 'no_database' };

  const sql = db();

  const read = async () =>
    (
      (await sql(
        `SELECT id, status, total_paise, gateway, gateway_order_id FROM orders WHERE id = $1`,
        [orderId]
      )) as {
        id: string;
        status: string;
        total_paise: number;
        gateway: string | null;
        gateway_order_id: string | null;
      }[]
    )[0];

  const order = await read();
  if (!order) return { ok: false, reason: 'unknown_order' };
  if (order.status === 'paid') return { ok: false, reason: 'already_paid' };

  // Already opened, on this gateway: send the customer back into it rather than opening a
  // second one against the same basket.
  if (order.gateway_order_id && order.gateway === gateway.name) {
    return {
      ok: true,
      gateway: gateway.name,
      gatewayOrderId: order.gateway_order_id,
      client: gateway.clientPayloadFor(order.gateway_order_id, Number(order.total_paise)),
    };
  }

  const idempotencyKey = `snapup:${orderId}`;
  const created = await gateway.createPayment({
    orderId,
    amountPaise: Number(order.total_paise),
    idempotencyKey,
    storeName,
  });

  const written = (await sql(
    `UPDATE orders
        SET gateway          = $2,
            gateway_order_id = $3,
            idempotency_key  = $4,
            payment_state    = COALESCE(payment_state, 'PAYMENT_PENDING')
      WHERE id = $1
        AND gateway_order_id IS NULL
      RETURNING id`,
    [orderId, gateway.name, created.gatewayOrderId, idempotencyKey]
  )) as { id: string }[];

  if (written.length === 0) {
    // Lost the race to another request for the same basket. Whatever it stored is the
    // gateway order this basket has; return that, not ours.
    const current = await read();
    if (current?.gateway_order_id) {
      return {
        ok: true,
        gateway: gateway.name,
        gatewayOrderId: current.gateway_order_id,
        client: gateway.clientPayloadFor(current.gateway_order_id, Number(current.total_paise)),
      };
    }
  }

  console.info(`[payments] opened ${gateway.name} order ${created.gatewayOrderId} for ${orderId}`);

  return {
    ok: true,
    gateway: gateway.name,
    gatewayOrderId: created.gatewayOrderId,
    client: created.clientPayload,
  };
}
