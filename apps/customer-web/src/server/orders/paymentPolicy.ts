import 'server-only';
import type { OrderStatus, PaymentConfirmation } from './types';

/**
 * The single rule that decides whether money is considered received.
 *
 * ## What this fixes
 *
 * Both repositories previously moved an order to `paid` for *any* confirmation, including
 * `customer_attested`. A customer tapping "I've paid" therefore produced a paid order, a
 * revenue event on the owner's dashboard, and an exit token — with no payment anywhere in
 * the loop. That is not a theoretical hole; it is the whole checkout flow.
 *
 * Under the direct-to-merchant UPI model the shop's own account receives the money and no
 * provider tells us anything, so the only real evidence is a person checking. This is the
 * one place that distinction is encoded, so it cannot drift between backends.
 */

/** Confirmations that mean the money is actually known to have arrived. */
const VERIFIED: PaymentConfirmation[] = ['staff_verified', 'psp_webhook', 'in_store_tender'];

export function isVerifiedPayment(confirmation: PaymentConfirmation): boolean {
  return VERIFIED.includes(confirmation);
}

/**
 * The status an order takes on when a confirmation of this strength arrives.
 *
 * `customer_attested` lands in `awaiting_verification`, not `paid`. The customer has done
 * their part and the shop has not yet seen it — a real, nameable state, rather than a
 * boolean forced to pick a side.
 */
export function statusForConfirmation(confirmation: PaymentConfirmation): OrderStatus {
  if (isVerifiedPayment(confirmation)) return 'paid';
  if (confirmation === 'customer_attested') return 'awaiting_verification';
  return 'awaiting_payment';
}

/**
 * Whether a new confirmation should be allowed to replace the current one.
 *
 * Strength ordering, so a retry or a late duplicate can never weaken what is already
 * known. The case this exists for: a customer taps "I've paid" *after* staff have already
 * verified — without this, an attestation would overwrite a verification and reopen a
 * settled order.
 */
const STRENGTH: Record<PaymentConfirmation, number> = {
  unconfirmed: 0,
  customer_attested: 1,
  in_store_tender: 2,
  staff_verified: 3,
  psp_webhook: 4,
};

export function isUpgrade(current: PaymentConfirmation, next: PaymentConfirmation): boolean {
  return STRENGTH[next] > STRENGTH[current];
}

/**
 * The same ordering as a number, for the SQL that enforces it inside an UPDATE.
 *
 * The Postgres repository compares strengths in the `WHERE` clause — doing it in
 * JavaScript would reintroduce the read-then-write race the statement exists to avoid.
 * The `CASE` in that query mirrors this table, and the two have to change together.
 */
export function confirmationStrength(confirmation: PaymentConfirmation): number {
  return STRENGTH[confirmation];
}

/**
 * Whether the exit gate may open on this order.
 *
 * Deliberately not "does it have a signed token". The token proves the order is real and
 * unaltered; this decides whether it was paid for. An attested order still gets a token —
 * it carries the basket and the weight the gate needs — but the gate must refuse it.
 */
export function mayExit(status: OrderStatus, confirmation: PaymentConfirmation): boolean {
  return status === 'paid' && isVerifiedPayment(confirmation);
}
