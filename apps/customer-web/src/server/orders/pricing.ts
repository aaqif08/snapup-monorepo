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
 * Where the service fee comes from.
 *
 * Two shapes, because the pilot has been described both ways: the bill generation guide
 * specifies a fixed amount hardcoded in the app, and the fee was separately described as a
 * tenth of the basket, waived on sign-in. Both are expressible here, and neither is a
 * database value — a fee is a business rule, not a product attribute, so changing it is one
 * edit rather than a migration.
 *
 * `SNAPUP_SERVICE_FEE_PAISE` sets a flat fee. Absent, the rate below applies: one tenth
 * of the item total, which a guest pays and a signed-in customer does not — the checkout
 * strikes it through and prints FREE, and the Snap Up Discount line carries the same
 * figure back off. That is why there is no separate discount percentage: the benefit
 * *is* the waiver, and a second rate would be a second number to keep in agreement
 * forever.
 */
export const SERVICE_FEE_RATE = 0.1;

export function serviceFeeFor(subtotalPaise: number): number {
  const flat = Number(process.env.SNAPUP_SERVICE_FEE_PAISE ?? '');
  if (Number.isFinite(flat) && flat >= 0 && process.env.SNAPUP_SERVICE_FEE_PAISE) {
    return Math.round(flat);
  }
  return Math.round(subtotalPaise * SERVICE_FEE_RATE);
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
  let gstPaise = 0;
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
    // SUM(gst_amount × qty), exactly as the bill guide specifies. Summed from what each
    // item already carries rather than applied to the basket, because different slabs sit
    // in one trolley — a 0% staple beside an 18% shampoo — and one basket-level rate
    // could not be right for both.
    gstPaise += Math.max(0, product.gst_amount_paise ?? 0) * cappedQuantity;
    totalCostPaise += lineCostPaise;
    expectedWeightGrams += product.expected_weight_grams * cappedQuantity;
  }

  const isVerified = context.verifiedCustomerId !== null;

  const serviceFeePaise = serviceFeeFor(subtotalPaise);

  // The membership benefit, in full. A member is charged the fee and then credited exactly
  // the same amount, so the bill shows both lines and nets to the goods plus tax. Expressing
  // it as a waiver rather than as "no fee" is what lets the checkout say what was saved.
  const discountPaise = isVerified ? serviceFeePaise : 0;

  // **GST is not added. It is already inside the item total.**
  //
  // Indian retail prices are GST-inclusive: the figure on the packet contains the tax and
  // the customer never pays it on top. The bill shows it because a customer is entitled to
  // see what tax they bore, not because anything is being charged — so this is a sum of
  // what was already collected, and it does not appear in `totalPaise` below.
  //
  // Adding it, as this did before the bill generation guide arrived, would have charged
  // every customer their tax twice the moment a rate was configured.

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
      // Item Total + Service Fee − Discount. GST is deliberately absent: it is inside
      // `subtotalPaise` already.
      totalPaise: subtotalPaise + serviceFeePaise - discountPaise,
      totalCostPaise,
      expectedWeightGrams,
      discountReason,
    },
  };
}
