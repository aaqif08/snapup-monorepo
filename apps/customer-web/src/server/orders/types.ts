import 'server-only';

/**
 * Server-priced orders.
 *
 * Before this existed the cart lived entirely in the browser: `useCartStore` computed the
 * total, `generateCheckoutToken()` minted the exit token from that total, and the UPI deep
 * link carried whatever amount the client put in it. Every one of those numbers was
 * editable in devtools, which was harmless while nothing charged money and becomes a live
 * fraud path the moment a real merchant VPA is configured.
 *
 * The rule this module enforces: the client sends *what* it wants to buy (product ids and
 * quantities), never *what it costs*. Price, discount, fee, total and expected weight are
 * all recomputed here from the store's own catalogue.
 */

export type OrderStatus =
  /** Priced and awaiting money. The only state a fresh order can be created in. */
  | 'awaiting_payment'
  | 'paid'
  /** Session ended or expired without payment. */
  | 'abandoned';

/**
 * How we know the money arrived. This is the crux of the phase-1 payment model, where
 * funds go straight to the shop's own UPI account and SnapUp is not a party to the
 * transaction — so no webhook exists to tell us anything.
 */
export type PaymentConfirmation =
  /** No evidence of payment. */
  | 'unconfirmed'
  /** The customer tapped "I've paid". Self-attested: not evidence, and must not gate exit alone. */
  | 'customer_attested'
  /** Store staff or the exit terminal matched the payment in the merchant's own app. */
  | 'staff_verified'
  /** A payment provider told us server-to-server. The only confirmation that scales. */
  | 'psp_webhook'
  /** Cash or card at the counter, recorded by the till. */
  | 'in_store_tender';

export interface OrderLine {
  productId: string;
  barcode: string;
  name: string;
  quantity: number;
  /**
   * Captured at order time, not referenced. Re-pricing an item next week must not restate
   * last week's revenue.
   */
  unitPricePaise: number;
  linePaise: number;
  /** Never serialised to a customer — Requirement 2 forbids exposing cost. Margin only. */
  unitCostPaise: number;
  lineCostPaise: number;
  expectedWeightGrams: number;
}

export interface OrderRecord {
  id: string;
  storeId: string;
  /** Anonymous shopping session that placed it. */
  sessionId: string;
  status: OrderStatus;
  lines: OrderLine[];

  subtotalPaise: number;
  discountPaise: number;
  platformFeePaise: number;
  totalPaise: number;
  /** Cost of goods, for the margin figure on the owner's dashboard. Internal only. */
  totalCostPaise: number;
  expectedWeightGrams: number;

  createdAt: number;
  paidAt: number | null;

  payment: {
    /** Merchant VPA money was directed to. Per-store under the phase-1 model. */
    payeeVpa: string | null;
    payeeName: string | null;
    /** Reconciliation key, echoed in the UPI `tr` parameter. */
    transactionRef: string;
    confirmation: PaymentConfirmation;
  };
}

export interface OrderDraftLine {
  productId: string;
  quantity: number;
}

export interface OrderRepository {
  create(order: Omit<OrderRecord, 'id'>): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  /** Scoped by session so one customer can never read another's order. */
  findForSession(sessionId: string, orderId: string): Promise<OrderRecord | null>;
  markPaid(id: string, confirmation: PaymentConfirmation): Promise<OrderRecord | null>;
}
