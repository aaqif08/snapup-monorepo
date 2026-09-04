import 'server-only';
import type { InternalProduct } from '../products';
import type { OrderDraftLine, OrderLine } from './types';

/**
 * Server-side pricing. The client never supplies a price, only an intent to buy.
 *
 * All arithmetic is in paise as integers. Rupee floats accumulate error across a
 * forty-item basket, and a total that is a paisa off from the merchant's own till is the
 * kind of discrepancy that ends a pilot.
 */

/**
 * The service fee: one tenth of the item total, and the whole of the membership offer.
 *
 * A guest pays it. A signed-in customer does not — the checkout strikes it through and
 * prints FREE, and the "Snap Up Discount" line carries the same figure back off the bill.
 * That is why there is no separate discount rate: the benefit *is* the waiver, so a second
 * percentage would be a second number that has to agree with this one forever.
 *
 * Rounded half-up on the subtotal. On ₹500 the fee is ₹50.
 */
export const SERVICE_FEE_RATE = 0.1;

/**
 * Tax on the bill, as a fraction.
 *
 * Zero by default, and deliberately so. Real GST is per-HSN — 0% on most staples, then 5,
 * 12, 18 — and the supplied catalogue carries neither an HSN code nor a rate. Inventing a
 * blended figure would put a number on a customer's tax invoice that no return could
 * justify, which is worse than showing nothing.
 *
 * `SNAPUP_GST_RATE` sets it for the pilot (e.g. `0.05`). The line is hidden entirely while
 * it is zero rather than printed as ₹0.00, because a tax line of zero invites the question
 * this comment exists to answer.
 */
export function gstRate(): number {
  const raw = Number(process.env.SNAPUP_GST_RATE ?? '0');
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0;
}

export const MAX_LINE_QUANTITY = 99;
export const MAX_DISTINCT_LINES = 200;

export type PricingFailure =
  | { code: 'empty_basket'; message: string }
  | { code: 'invalid_quantity'; message: string }
  | { code: 'too_many_lines'; message: string }
  | { code: 'unknown_product'; message: string; productId: string };

export interface PricedOrder {
  lines: OrderLine[];
  /** Item Total: what the goods come to, after any shelf promotion. */
  subtotalPaise: number;
  /** What the shop's own markdowns took off. Shown in the cart, not as a bill line. */
  productSavingsPaise: number;
  /** Charged to a guest, waived for a member. */
  serviceFeePaise: number;
  /** The waiver, so guest and member bills are the same shape. Equals the fee, or zero. */
  discountPaise: number;
  gstPaise: number;
  /** Retained under its old name so nothing downstream breaks; always the service fee. */
  platformFeePaise: number;
  totalPaise: number;
  totalCostPaise: number;
  expectedWeightGrams: number;
  /**
   * Why a discount was or was not granted. Surfaced to the client so the UI can explain
   * itself instead of silently showing a different number than the customer expected.
   */
  discountReason: 'applied' | 'not_authenticated' | 'identity_unverifiable';
}

export type PricingResult =
  | { ok: true; order: PricedOrder }
  | { ok: false; failure: PricingFailure };

export interface PricingContext {
  /**
   * A customer identity the *server* has verified.
   *
   * Deliberately not a boolean from the client. `checkout/page.tsx` reads `isAuthenticated`
   * out of localStorage, so anyone can set it in devtools and claim the 5% — which was
   * noted as harmless while no money moved, and stops being harmless the moment it does.
   *
   * Customer login is still mocked, so nothing can populate this yet and the discount is
   * correctly withheld rather than granted on an unverifiable claim. When real customer
   * auth lands, it sets this field and nothing else in the pricing path changes.
   */
  verifiedCustomerId: string | null;
  /** True when the client believes it is logged in, used only to explain the difference. */
  clientClaimsAuthenticated: boolean;
}

export function priceOrder(
  draftLines: OrderDraftLine[],
  catalogue: Map<string, InternalProduct>,
  context: PricingContext
): PricingResult {
  if (draftLines.length === 0) {
    return { ok: false, failure: { code: 'empty_basket', message: 'The basket is empty.' } };
  }
  if (draftLines.length > MAX_DISTINCT_LINES) {
    return {
      ok: false,
      failure: {
        code: 'too_many_lines',
        message: `An order cannot contain more than ${MAX_DISTINCT_LINES} distinct items.`,
      },
    };
  }

  // Collapse duplicates before pricing: a client that sends the same product twice should
  // get one line of quantity two, not two lines that each look valid to the exit terminal.
  const merged = new Map<string, number>();
  for (const line of draftLines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_LINE_QUANTITY
    ) {
      return {
        ok: false,
        failure: {
          code: 'invalid_quantity',
          message: `Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}.`,
        },
      };
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  }

  const lines: OrderLine[] = [];
  let subtotalPaise = 0;
  let productSavingsPaise = 0;
  let totalCostPaise = 0;
  let expectedWeightGrams = 0;

  for (const [productId, quantity] of merged) {
    const product = catalogue.get(productId);

    // A withdrawn product is excluded from the catalogue map by the caller, so this also
    // covers "was in the cart, has since been delisted" — which a long session makes real.
    if (!product) {
      return {
        ok: false,
        failure: {
          code: 'unknown_product',
          message: 'One of the items in your basket is no longer available in this store.',
          productId,
        },
      };
    }

    const cappedQuantity = Math.min(quantity, MAX_LINE_QUANTITY);

    // The shop's own markdown, applied to everyone. Clamped so a bad catalogue row can
    // never make an item free or negative, which would otherwise be a way to pay less by
    // buying more of it.
    const promotionPaise = Math.min(
      Math.max(0, product.discount_paise ?? 0),
      product.unit_price
    );
    const effectiveUnitPaise = product.unit_price - promotionPaise;
    const linePaise = effectiveUnitPaise * cappedQuantity;
    const lineCostPaise = product.cost_price * cappedQuantity;

    lines.push({
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      quantity: cappedQuantity,
      // What is actually charged, not the shelf ticket — every downstream figure, the
      // exit token included, has to agree with the money that changed hands.
      unitPricePaise: effectiveUnitPaise,
      linePaise,
      unitCostPaise: product.cost_price,
      lineCostPaise,
      expectedWeightGrams: product.expected_weight_grams * cappedQuantity,
    });

    subtotalPaise += linePaise;
    productSavingsPaise += promotionPaise * cappedQuantity;
    totalCostPaise += lineCostPaise;
    expectedWeightGrams += product.expected_weight_grams * cappedQuantity;
  }

  const isVerified = context.verifiedCustomerId !== null;

  const serviceFeePaise = Math.round(subtotalPaise * SERVICE_FEE_RATE);

  // The membership benefit, in full. A member is charged the fee and then credited exactly
  // the same amount, so the bill shows both lines and nets to the goods plus tax. Expressing
  // it as a waiver rather than as "no fee" is what lets the checkout say what was saved.
  const discountPaise = isVerified ? serviceFeePaise : 0;

  // Tax on what is actually payable — goods plus any fee that survives the waiver. Charging
  // it on a fee the customer is not paying would overstate the bill for every member.
  const taxablePaise = subtotalPaise + serviceFeePaise - discountPaise;
  const gstPaise = Math.round(taxablePaise * gstRate());

  const discountReason: PricedOrder['discountReason'] = isVerified
    ? 'applied'
    : context.clientClaimsAuthenticated
      ? 'identity_unverifiable'
      : 'not_authenticated';

  return {
    ok: true,
    order: {
      lines: lines.sort((a, b) => a.name.localeCompare(b.name)),
      subtotalPaise,
      productSavingsPaise,
      serviceFeePaise,
      discountPaise,
      gstPaise,
      platformFeePaise: serviceFeePaise,
      totalPaise: subtotalPaise + serviceFeePaise - discountPaise + gstPaise,
      totalCostPaise,
      expectedWeightGrams,
      discountReason,
    },
  };
}
