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

/** Matches the ₹2.00 shown at checkout. The single definition — the UI reads it from here. */
export const PLATFORM_FEE_PAISE = 200;

/** FR-3: 5% for a logged-in customer, on the item subtotal only, never on the fee. */
export const LOGIN_DISCOUNT_RATE = 0.05;

export const MAX_LINE_QUANTITY = 99;
export const MAX_DISTINCT_LINES = 200;

export type PricingFailure =
  | { code: 'empty_basket'; message: string }
  | { code: 'invalid_quantity'; message: string }
  | { code: 'too_many_lines'; message: string }
  | { code: 'unknown_product'; message: string; productId: string };

export interface PricedOrder {
  lines: OrderLine[];
  subtotalPaise: number;
  discountPaise: number;
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
    const linePaise = product.unit_price * cappedQuantity;
    const lineCostPaise = product.cost_price * cappedQuantity;

    lines.push({
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      quantity: cappedQuantity,
      unitPricePaise: product.unit_price,
      linePaise,
      unitCostPaise: product.cost_price,
      lineCostPaise,
      expectedWeightGrams: product.expected_weight_grams * cappedQuantity,
    });

    subtotalPaise += linePaise;
    totalCostPaise += lineCostPaise;
    expectedWeightGrams += product.expected_weight_grams * cappedQuantity;
  }

  const isVerified = context.verifiedCustomerId !== null;
  const discountPaise = isVerified ? Math.round(subtotalPaise * LOGIN_DISCOUNT_RATE) : 0;

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
      discountPaise,
      platformFeePaise: PLATFORM_FEE_PAISE,
      totalPaise: subtotalPaise - discountPaise + PLATFORM_FEE_PAISE,
      totalCostPaise,
      expectedWeightGrams,
      discountReason,
    },
  };
}
