import { NextResponse, type NextRequest } from 'next/server';
import { activeGateway } from '@/server/payments/gateway';
import { recordGatewayOutcome } from '@/server/payments/record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The only route that can mark a basket paid.
 *
 * ## Why the customer app cannot do this
 *
 * Section 2 of the brief: "Never trust a payment-success value sent directly by the customer
 * app." A page that says it paid is a page under the customer's control, and the shopper who
 * edits it walks out with a basket the shop believes was settled. What arrives here instead
 * is a statement from the gateway, signed with a secret the app has never been given, and
 * the signature is checked before anything is read out of the body.
 *
 * ## Why it always answers 200, even for a rejected signature
 *
 * Gateways retry non-2xx responses, sometimes for days. A 401 for a bad signature would
 * therefore ask an attacker's forged webhook to be replayed at us on a schedule, and would
 * let a spammer generate traffic on demand. The event is dropped and logged; the caller is
 * told nothing about why.
 *
 * The one exception is a genuine processing failure after a *valid* signature, which does
 * return 500 — there a retry is exactly what we want.
 */
export async function POST(request: NextRequest) {
  const gateway = await activeGateway();

  // No gateway configured: the pilot is on UPI deep links with staff verification, and
  // nothing should be posting here. 404 rather than 200, because this endpoint genuinely
  // does not exist in that configuration.
  if (!gateway) {
    return NextResponse.json(
      { error: { code: 'gateway_not_configured', message: 'No payment gateway is configured.' } },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  // Raw, unparsed. The signature covers the bytes that arrived; `request.json()` would
  // reorder keys and rewrite whitespace before we ever got to check it.
  const rawBody = await request.text();

  const event = gateway.verifyWebhook(rawBody, request.headers);
  if (!event) {
    console.warn('[payments] webhook rejected: signature did not verify');
    return NextResponse.json({ received: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
  }

  try {
    const result = await recordGatewayOutcome(gateway.name, event);
    // `duplicate` is the normal case for a retried webhook, not a problem: the unique index
    // on (gateway, gateway_payment_id) refused the second write and nothing moved.
    console.info(
      `[payments] ${event.outcome} ${event.gatewayPaymentId} -> order ${event.orderId} (${result})`
    );
    return NextResponse.json({ received: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // A verified event we could not record. 500 asks the gateway to retry, which is the
    // right outcome — the alternative is a paid basket the shop never hears about.
    console.error('[payments] failed to record a verified webhook', error);
    return NextResponse.json(
      { error: { code: 'record_failed', message: 'Could not record the payment.' } },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    );
  }
}
