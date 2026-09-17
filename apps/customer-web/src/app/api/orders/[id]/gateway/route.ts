import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { orderRepository } from '@/server/orders';
import { initiateGatewayPayment } from '@/server/payments/initiate';
import { getStore } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts a gateway payment for the caller's own order.
 *
 * Returns what the gateway's checkout widget needs to open — a publishable key and the
 * gateway's order id — and nothing that could mark the basket paid. The result of the
 * payment reaches us by the gateway's signed webhook, never from this phone; the client
 * polls `GET /api/orders/[id]` and sees `payment.confirmation` become `psp_webhook` when
 * it has.
 *
 * 404 `gateway_not_configured` is a supported answer, not an error: the pilot runs on UPI
 * deep links with staff verification until a gateway is chosen, and the checkout screen
 * falls back to that path when it sees this.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  // Scoped to the session: an order id copied from someone else's phone opens nothing.
  const order = await orderRepository.findForSession(guard.session.sub, id, guard.session.sid);
  if (!order) return fail(404, 'order_not_found', 'This order does not exist.');

  const store = await getStore(order.storeId);

  const outcome = await initiateGatewayPayment(order.id, store?.name ?? 'SnapUp');

  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'gateway_not_configured':
        return fail(404, 'gateway_not_configured', 'No payment gateway is configured.');
      case 'no_database':
        return fail(503, 'gateway_unavailable', 'Gateway payments need a durable database.');
      case 'already_paid':
        return fail(409, 'already_paid', 'This order has already been paid.');
      case 'unknown_order':
        return fail(404, 'order_not_found', 'This order does not exist.');
    }
  }

  return NextResponse.json(
    { gateway: outcome.gateway, gateway_order_id: outcome.gatewayOrderId, client: outcome.client },
    { status: 200, headers: NO_STORE }
  );
}

const NO_STORE = { 'cache-control': 'no-store' };

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}
