import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { issueExitToken, orderRepository, toCustomerOrder } from '@/server/orders';
import type { PaymentConfirmation } from '@/server/orders';
import { recordEvent } from '@/server/analytics';
import { isVerifiedPayment, mayExit } from '@/server/orders/paymentPolicy';

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
  //
  // `session.sid` is passed for routing only: on a chain where each branch hosts its own
  // database, the order id alone does not say which system holds the record. It comes from
  // the signed token, so it cannot be pointed at another branch by the caller — and it is
  // not what authorises the read, which is still `session.sub`.
  const existing = await orderRepository.findForSession(guard.session.sub, id, guard.session.sid);
  if (!existing) return fail(404, 'order_not_found', 'This order does not exist.');

  const alreadyPaid = existing.status === 'paid';
  const order = await orderRepository.markPaid(id, confirmation, guard.session.sid);
  if (!order) return fail(404, 'order_not_found', 'This order does not exist.');

  // Revenue counts money that is known to have arrived, not baskets and not claims.
  //
  // This previously fired for `customer_attested` as well, which put every unpaid basket
  // where somebody tapped "I've paid" straight into the owner's takings. Under the
  // direct-to-merchant model that tap is the *only* signal the app gets, so the guard has
  // to be the confirmation strength rather than the fact that a request arrived.
  //
  // For an attested order the event fires later, when staff verify it at the exit.
  if (!alreadyPaid && isVerifiedPayment(confirmation)) {
    recordEvent({
      storeId: order.storeId,
      sessionId: order.sessionId,
      kind: 'order_placed',
      occurredAt: order.paidAt ?? Date.now(),
      orderId: order.id,
      grossPaise: order.totalPaise,
      // The fee this order actually carried — zero when the customer was signed in
      // and the waiver applied. Recorded rather than recomputed, so a later change
      // to the rate cannot rewrite what was already taken.
      feePaise: order.platformFeePaise,
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

  // The gate opens on evidence, not on a claim. An attested order gets no token at all:
  // issuing one that the terminal is expected to refuse just moves the argument to the
  // exit, where there is a queue behind it.
  const exit = mayExit(order.status, order.payment.confirmation) ? issueExitToken(order) : null;

  return NextResponse.json(
    {
      order: toCustomerOrder(order),
      exit_token: exit?.token ?? null,
      exit_token_expires_at: exit?.expiresAt ?? null,
      /**
       * Shown to staff at the exit desk when the payment still needs checking. This is the
       * customer's half of the verification handshake — they read it out, staff type it.
       */
      verification_code: order.verificationCode,
      /**
       * Told to the client plainly so the confirmation screen can set the right
       * expectation — "show this at the exit" versus "staff will check your payment" is a
       * materially different instruction, and guessing wrong at the gate is what makes a
       * queue.
       */
      payment_verified: mayExit(order.status, order.payment.confirmation),
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
