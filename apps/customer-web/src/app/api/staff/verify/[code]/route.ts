import { NextResponse, type NextRequest } from 'next/server';
import {
  compareWeight,
  isPlausibleReading,
  toleranceForLines,
} from '@/server/orders/weightPolicy';
import {
  coverageFor,
  explainGap,
  hasBlindSpot,
} from '@/server/orders/weightExplain';
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

        // The scale check. `expected_weight_grams` is computed from the catalogue at
        // order time, so it is the sum of what was actually scanned — not anything the
        // phone could edit. `tolerance_grams` is sent rather than left to the client to
        // work out, so the number staff are shown is provably the number the server
        // judges against.
        expected_weight_grams: order.expectedWeightGrams,
        tolerance_grams: toleranceForLines(order.lines),
      },
      store: { id: order.storeId, name: store?.name ?? order.storeId },

      // What the weight check can and cannot see, sent with the lookup rather than left
      // for the mismatch. Staff need it *before* they weigh: knowing three items carry no
      // weight changes how they read the number, and is the difference between an informed
      // override and a reflexive one.
      coverage: (() => {
        const coverage = coverageFor(order.lines);
        return {
          total_units: coverage.totalUnits,
          unchecked_units: coverage.uncheckedUnits,
          unchecked_names: coverage.uncheckedNames,
          checked_rupees: (coverage.checkedValuePaise / 100).toFixed(2),
          unchecked_rupees: (coverage.uncheckedValuePaise / 100).toFixed(2),
        };
      })(),
      blind_spot: await (async () => {
        const tolerance = toleranceForLines(order.lines);
        const { lightestItemGrams, lightestItemName } = await explainGap(order.storeId, 0);
        return hasBlindSpot(tolerance, lightestItemGrams)
          ? { lightest_item_grams: lightestItemGrams, lightest_item_name: lightestItemName }
          : null;
      })(),
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

  // ---- the scale check ----
  //
  // Judged here rather than on the staff phone. The phone shows the comparison so the
  // person can see it, but a client that decides whether it matched is a client that can
  // be told to say yes.
  const body = (await request.json().catch(() => ({}))) as {
    observed_weight_grams?: unknown;
    override?: unknown;
    /** `proceed` releases the bill and moves stock; `deny` does neither. */
    action?: unknown;
    reason?: unknown;
  };

  // ---- Deny ----
  //
  // Handled before anything else, and before the weight gate: refusing a basket is not a
  // failed approval, it is a decision, and it must be possible on a basket that never
  // reached the scale. Releases no bill, moves no stock, and records who and why.
  if (body.action === 'deny') {
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 300)
        : 'No reason given';

    const denied = await orderRepository.denyExit(found.id, actor.id, reason, Date.now());
    if (!denied) {
      return fail(409, 'already_authorised', 'That basket has already been cleared to leave.');
    }

    console.warn(
      `[exit] ${actor.email ?? actor.id} DENIED ${denied.id} (${normalised}) ` +
        `for ${(denied.totalPaise / 100).toFixed(2)} at ${denied.storeId}: ${reason}`
    );

    return NextResponse.json(
      {
        verified: false,
        denied: true,
        order_id: denied.id,
        denied_by: actor.name ?? actor.email,
        reason,
        // Stated rather than implied. The customer's money is not refunded by this — the
        // basket is held for someone to sort out at the counter.
        bill_released: false,
      },
      { status: 200, headers: NO_STORE }
    );
  }

  let comparison: ReturnType<typeof compareWeight> | null = null;

  if (body.observed_weight_grams !== undefined) {
    if (!isPlausibleReading(body.observed_weight_grams)) {
      return fail(
        400,
        'implausible_weight',
        'That scale reading is not a usable number. Enter the weight in grams.'
      );
    }

    comparison = compareWeight(
      found.expectedWeightGrams,
      body.observed_weight_grams,
      toleranceForLines(found.lines)
    );

    // A mismatch stops here unless the member of staff explicitly overrides. Two separate
    // actions on purpose: the first tap must not be able to wave through a basket that is
    // half a kilo heavy because someone was clearing a queue.
    if (!comparison.matches && body.override !== true) {
      const explanation = await explainGap(found.storeId, comparison.differenceGrams);

      return NextResponse.json(
        {
          verified: false,
          reason: 'weight_mismatch',
          weight: comparison,
          // What to look for, rather than only that something is wrong.
          explanation,
          message:
            comparison.direction === 'heavier'
              ? 'The basket weighs more than it should. Check for an unscanned item.'
              : 'The basket weighs less than it should. Check nothing was left behind.',
        },
        { status: 409, headers: NO_STORE }
      );
    }
  }

  const overrode = comparison !== null && !comparison.matches;

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
    // The fee this order actually carried — zero when the waiver applied.
    feePaise: verified.platformFeePaise,
    costPaise: verified.totalCostPaise,
    itemCount: verified.lines.reduce((total, line) => total + line.quantity, 0),
    lines: verified.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      linePaise: line.linePaise,
    })),
  });

  // ---- Proceed ----
  //
  // Authorising the exit is what releases the bill and moves the stock, and it happens here
  // rather than at payment. `approveExit` returns null when the order was already
  // authorised, which is how a replayed exit QR is refused: the second scan finalises no
  // inventory and issues no token.
  const authorised = mayExit(verified.status, verified.payment.confirmation)
    ? await orderRepository.approveExit(verified.id, actor.id, Date.now())
    : null;

  if (mayExit(verified.status, verified.payment.confirmation) && !authorised) {
    return fail(
      409,
      'already_authorised',
      'That basket has already been cleared to leave, or was denied.'
    );
  }

  const exit = authorised ? issueExitToken(authorised) : null;

  if (comparison) {
    await orderRepository.recordWeightCheck({
      orderId: verified.id,
      observedGrams: comparison.observedGrams,
      checkedBy: actor.id,
      at: Date.now(),
      // Written only when the reading disagreed and staff went ahead regardless. This is
      // the column that makes an override answerable afterwards; an unattributable
      // override is indistinguishable from having no check at all.
      overrodeBy: overrode ? actor.id : null,
    });
  }

  console.info(
    `[exit] ${actor.email ?? actor.id} verified ${verified.id} (${normalised}) ` +
      `for ${(verified.totalPaise / 100).toFixed(2)} at ${verified.storeId}` +
      (comparison
        ? ` · scale ${comparison.observedGrams}g vs ${comparison.expectedGrams}g` +
          (overrode ? ` · OVERRIDE (${comparison.differenceGrams > 0 ? '+' : ''}${comparison.differenceGrams}g)` : '')
        : ' · no scale reading')
  );

  return NextResponse.json(
    {
      verified: true,
      // Only true once the exit is authorised. The customer's bill appears in their
      // history at this moment and not before.
      bill_released: authorised !== null,
      inventory_finalised: authorised?.inventoryFinalisedAt !== null && authorised !== null,
      order_id: verified.id,
      total_rupees: (verified.totalPaise / 100).toFixed(2),
      verified_by: actor.name ?? actor.email,
      weight: comparison,
      weight_overridden: overrode,
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
