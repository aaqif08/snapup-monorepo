import 'server-only';
import { signPayload, verifyPayload } from '../crypto';
import { EXIT_TOKEN_SIGNING_SECRET, EXIT_TOKEN_TTL_SECONDS } from '../env';
import type { OrderRecord, PaymentConfirmation } from './types';

/**
 * What a customer is allowed to see of their own order.
 *
 * Cost price and line cost are on the record for the owner's margin figures and must never
 * cross this boundary — the same rule `products/projection.ts` enforces for the catalogue.
 * Projecting explicitly, field by field, is why: spreading the record and deleting keys
 * leaks every field added later.
 */
export interface CustomerOrder {
  id: string;
  store_id: string;
  status: OrderRecord['status'];
  lines: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  subtotal: number;
  /** What the shop's own markdowns took off. Shown in the cart, not as a bill line. */
  product_savings: number;
  /** Charged to a guest, struck through and free for a member. */
  service_fee: number;
  /** The waiver. Equals `service_fee` for a member, zero for a guest. */
  discount: number;
  gst: number;
  /** Deprecated alias for `service_fee`, kept so older clients keep working. */
  platform_fee: number;
  total: number;
  expected_weight_grams: number;
  payment: {
    payee_vpa: string | null;
    payee_name: string | null;
    transaction_ref: string;
    confirmation: PaymentConfirmation;
  };
  created_at: number;
}

export function toCustomerOrder(order: OrderRecord): CustomerOrder {
  return {
    id: order.id,
    store_id: order.storeId,
    status: order.status,
    lines: order.lines.map((line) => ({
      product_id: line.productId,
      name: line.name,
      quantity: line.quantity,
      unit_price: line.unitPricePaise,
      line_total: line.linePaise,
    })),
    subtotal: order.subtotalPaise,
    product_savings: order.productSavingsPaise,
    service_fee: order.serviceFeePaise,
    discount: order.discountPaise,
    gst: order.gstPaise,
    platform_fee: order.platformFeePaise,
    total: order.totalPaise,
    expected_weight_grams: order.expectedWeightGrams,
    payment: {
      payee_vpa: order.payment.payeeVpa,
      payee_name: order.payment.payeeName,
      transaction_ref: order.payment.transactionRef,
      confirmation: order.payment.confirmation,
    },
    created_at: order.createdAt,
  };
}

/**
 * The token shown as a QR at the exit gate.
 *
 * Replaces the client-generated `checkoutToken` — a plain JSON blob built in
 * `useCartStore.generateCheckoutToken()` from client-side totals, which anyone could hand
 * craft with any weight and any price. This one is HMAC-signed server-side over figures the
 * server computed, so the exit terminal can verify it came from us and has not been edited.
 */
export interface ExitTokenPayload {
  v: number;
  /** Order id — the reconciliation key the terminal reports back. */
  oid: string;
  /** Store, so a token from one shop cannot open another shop's gate. */
  sid: string;
  /** Expected basket weight in grams, for the scale check. */
  w: number;
  /** Total charged, in paise. */
  amt: number;
  items: number;
  /**
   * How the payment was confirmed, carried into the gate on purpose.
   *
   * Under the phase-1 direct-to-merchant model this is usually `customer_attested`, which
   * is a claim and not evidence. The terminal must treat that differently from
   * `psp_webhook` — typically by asking staff to eyeball the merchant's own payment app
   * before opening. Encoding it here is what lets the gate make that distinction instead of
   * trusting every signed token equally.
   */
  conf: PaymentConfirmation;
  iat: number;
  exp: number;
}

export const EXIT_TOKEN_VERSION = 1;

export function issueExitToken(order: OrderRecord): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + EXIT_TOKEN_TTL_SECONDS;

  const payload: ExitTokenPayload = {
    v: EXIT_TOKEN_VERSION,
    oid: order.id,
    sid: order.storeId,
    w: order.expectedWeightGrams,
    amt: order.totalPaise,
    items: order.lines.reduce((acc, line) => acc + line.quantity, 0),
    conf: order.payment.confirmation,
    iat: now,
    exp,
  };

  return { token: signPayload(payload, EXIT_TOKEN_SIGNING_SECRET), expiresAt: exp };
}

export type ExitTokenValidation =
  | { valid: true; payload: ExitTokenPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'unknown_version' | 'expired' };

/**
 * Verification side, for the exit terminal. Nothing calls this yet — the terminal is
 * hardware that does not exist in this repo — but the token is worthless without a defined
 * counterpart, and defining it here keeps the payload shape from drifting.
 */
export function verifyExitToken(token: string): ExitTokenValidation {
  const result = verifyPayload<ExitTokenPayload>(token, EXIT_TOKEN_SIGNING_SECRET);
  if (!result.valid) return { valid: false, reason: result.reason };

  const payload = result.payload;
  if (payload.v !== EXIT_TOKEN_VERSION) return { valid: false, reason: 'unknown_version' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}
