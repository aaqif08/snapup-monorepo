import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/server/accounts/session';
import { orderRepository } from '@/server/orders';
import { mayExit } from '@/server/orders/paymentPolicy';
import { issueExitToken } from '@/server/orders';
import {
  isWellFormedCode,
  normaliseVerificationCode,
} from '@/server/orders/verificationCode';
import { recordEvent } from '@/server/analytics';
import { getStore } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

/**
 * The exit desk.
 *
 * Under the direct-to-merchant UPI model money goes straight to the shop's own account and
 * no provider tells SnapUp anything. A customer tapping "I've paid" is therefore a claim,
 * and this is where a person turns that claim into evidence: staff read the code off the
 * customer's phone, this returns the amount and the reference to check, and they match it
 * against the shop's own UPI app before confirming.
 *
 * Everything here is guarded by a **console session**, not the shared machine token. Who
 * opened the gate has to be answerable to a name, and `verified_by` records exactly that.
 */

/** What staff need on screen to decide: amount, reference, and what is in the basket. */
export async function GET(request: NextRequest, { params }: Params) {
  const actor = await requireRole(request, 'staff');
  if (!actor) return forbidden();

  const { code } = await params;
  const normalised = normaliseVerificationCode(code);
  if (!isWellFormedCode(normalised)) {
    return fail(400, 'malformed_code', 'That is not a six-character SnapUp code.');
  }

  // A staff member tied to a branch may only look up orders from that branch. An
  // unscoped account (an owner) has to say which store, because a code resolved against
  // the wrong branch is a basket nobody at this exit is holding.
  const storeId = actor.storeId ?? request.nextUrl.searchParams.get('store_id');
  if (!storeId) {
    return fail(
      400,
      'store_required',
      'Choose which branch you are verifying for. Your account is not tied to one.'
    );
  }

  const order = await orderRepository.findByVerificationCode(storeId, normalised);
  if (!order) {
    // Deliberately one message for "no such code", "already verified" and "wrong branch".
    // Staff act identically on all three — look again, ask the customer — and separating
    // them would let anyone with a till enumerate live baskets.
    return fail(404, 'not_found', 'No basket is waiting on that code at this branch.');
  }

  const store = await getStore(order.storeId);

  return NextResponse.json(
    {
      order: {
        id: order.id,
        code: order.verificationCode,
        status: order.status,
        confirmation: order.payment.confirmation,
        total_rupees: (order.totalPaise / 100).toFixed(2),
        items: order.lines.reduce((total, line) => total + line.quantity, 0),
        lines: order.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          // Rupees, formatted here so a till never has to divide by 100 and never shows a
          // customer-facing figure that disagrees with the app by a paisa.
          line_rupees: (line.linePaise / 100).toFixed(2),
        })),
        // What staff match against in the shop's own UPI app.
        transaction_ref: order.payment.transactionRef,
        payee_vpa: order.payment.payeeVpa,
        created_at: order.createdAt,
      },
      store: { id: order.storeId, name: store?.name ?? order.storeId },
      // `awaiting_verification` means the customer has claimed payment. `awaiting_payment`
      // means they have not even done that — worth showing, because it usually means they
      // are at the wrong desk rather than that anything is wrong.
      customer_claims_paid: order.status === 'awaiting_verification',
    },
    { status: 200, headers: NO_STORE }
  );
}

/**
 * Confirm the money arrived.
 *
 * This is the only transition that produces a usable exit token, and it is the one action
 * in the system where a careless tap costs the shop the price of a basket. So it records
 * who did it, and it is guarded inside the UPDATE rather than by a read-then-check — two
 * staff scanning the same code at a busy exit must not both succeed.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const actor = await requireRole(request, 'staff');
  if (!actor) return forbidden();

  const { code } = await params;
  const normalised = normaliseVerificationCode(code);
  if (!isWellFormedCode(normalised)) {
    return fail(400, 'malformed_code', 'That is not a six-character SnapUp code.');
  }

  const storeId = actor.storeId ?? request.nextUrl.searchParams.get('store_id');
  if (!storeId) return fail(400, 'store_required', 'Choose which branch you are verifying for.');

  const found = await orderRepository.findByVerificationCode(storeId, normalised);
  if (!found) return fail(404, 'not_found', 'No basket is waiting on that code at this branch.');

  const verified = await orderRepository.markVerified(found.id, actor.id, Date.now());
  if (!verified) {
    // Lost the race, or the order moved on between the lookup and the write.
    return fail(409, 'already_settled', 'That basket has just been settled by someone else.');
  }

  // Revenue is counted here and nowhere else, because this is the first moment the money is
  // known to exist. Counting at "I've paid" would put unpaid baskets in the owner's takings.
  recordEvent({
    storeId: verified.storeId,
    sessionId: verified.sessionId,
    kind: 'order_placed',
    occurredAt: verified.paidAt ?? Date.now(),
    orderId: verified.id,
    grossPaise: verified.totalPaise,
    costPaise: verified.totalCostPaise,
    itemCount: verified.lines.reduce((total, line) => total + line.quantity, 0),
    lines: verified.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      linePaise: line.linePaise,
    })),
  });

  const exit = mayExit(verified.status, verified.payment.confirmation)
    ? issueExitToken(verified)
    : null;

  console.info(
    `[exit] ${actor.email ?? actor.id} verified ${verified.id} (${normalised}) ` +
      `for ${(verified.totalPaise / 100).toFixed(2)} at ${verified.storeId}`
  );

  return NextResponse.json(
    {
      verified: true,
      order_id: verified.id,
      total_rupees: (verified.totalPaise / 100).toFixed(2),
      verified_by: actor.name ?? actor.email,
      exit_token: exit?.token ?? null,
      exit_expires_at: exit?.expiresAt ?? null,
    },
    { status: 200, headers: NO_STORE }
  );
}

const NO_STORE = { 'cache-control': 'no-store' };

function forbidden() {
  return fail(403, 'forbidden', 'Sign in with a staff account to verify payments.');
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}
