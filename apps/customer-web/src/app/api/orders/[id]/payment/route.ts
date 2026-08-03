import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { issueExitToken, orderRepository, toCustomerOrder } from '@/server/orders';
import type { PaymentConfirmation } from '@/server/orders';
import { recordEvent } from '@/server/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Records how an order was paid and issues the exit token.
 *
 * This is where the phase-1 payment model shows its one real weakness, so it is worth
 * being explicit rather than hiding it behind a green tick.
 *
 * Because customer money goes straight to the shop's own UPI account, SnapUp is not a
 * party to the transaction and no payment provider will ever call us to say it succeeded.
 * The only signal available in-app is the customer tapping "I've paid" — a claim, not
 * evidence. So this route records `customer_attested` and stamps that level into the exit
 * token, letting the gate treat it differently from a confirmation we actually verified.
 *
 * What closes the gap, in rough order of preference:
 *   1. A PSP with split settlement (Razorpay Route, Cashfree Easy Split, PhonePe
 *      sub-merchant). Money still lands in the merchant's account, but a server-to-server
 *      webhook hits `psp_webhook` here and the trust hole disappears.
 *   2. Staff verification at the exit against the merchant's own UPI app -> `staff_verified`.
 *      Workable for a single-store pilot, does not scale.
 *
 * Until one of those exists, `customer_attested` must not be treated as paid by the gate.
 */
const ACCEPTED_METHODS: Record<string, PaymentConfirmation> = {
  /** Customer says they completed a UPI payment to the shop. Unverified by design. */
  upi_attested: 'customer_attested',
  /** Cash or card at the counter — the till is the record, not us. */
  in_store: 'in_store_tender',
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: { method?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const confirmation =
    typeof body.method === 'string' ? ACCEPTED_METHODS[body.method] : undefined;
  if (!confirmation) {
    return fail(
      400,
      'unsupported_method',
      `method must be one of: ${Object.keys(ACCEPTED_METHODS).join(', ')}.`
    );
  }

  // Scoped to the calling session inside the repository, so an order id guessed or copied
  // from another customer resolves to nothing rather than to their basket.
  const existing = await orderRepository.findForSession(guard.session.sub, id);
  if (!existing) return fail(404, 'order_not_found', 'This order does not exist.');

  const alreadyPaid = existing.status === 'paid';
  const order = await orderRepository.markPaid(id, confirmation);
  if (!order) return fail(404, 'order_not_found', 'This order does not exist.');

  // Revenue counts money, not baskets, so the analytics event fires here rather than at
  // order creation — an abandoned basket must never appear in the owner's takings. Guarded
  // on `alreadyPaid` so a double tap or a retried request cannot count the sale twice.
  if (!alreadyPaid) {
    recordEvent({
      storeId: order.storeId,
      sessionId: order.sessionId,
      kind: 'order_placed',
      occurredAt: order.paidAt ?? Date.now(),
      orderId: order.id,
      grossPaise: order.totalPaise,
      costPaise: order.totalCostPaise,
      itemCount: order.lines.reduce((acc, line) => acc + line.quantity, 0),
      lines: order.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        linePaise: line.linePaise,
      })),
    });
  }

  const exit = issueExitToken(order);

  return NextResponse.json(
    {
      order: toCustomerOrder(order),
      exit_token: exit.token,
      exit_token_expires_at: exit.expiresAt,
      /**
       * Told to the client plainly so the confirmation screen can set the right
       * expectation — "show this at the exit" versus "staff will check your payment" is a
       * materially different instruction, and guessing wrong at the gate is what makes a
       * queue.
       */
      payment_verified: confirmation !== 'customer_attested',
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
