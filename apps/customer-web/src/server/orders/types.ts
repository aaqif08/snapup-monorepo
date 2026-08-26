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
  /**
   * The customer says they have paid; nobody has checked.
   *
   * This state exists because conflating it with `paid` is the difference between a shop
   * that works and a shop that is being robbed. Under the direct-to-merchant UPI model no
   * provider tells us anything, so a tap on "I've paid" is a claim. The order waits here
   * until a member of staff matches it against the shop's own UPI app.
   */
  | 'awaiting_verification'
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

  /**
   * The signed-in customer, when there was one.
   *
   * Null for a guest checkout, which is a legitimate outcome rather than a gap — the
   * catalogue is usable without an account. Those bills exist only on the device that
   * made them, which is the trade a guest is making.
   */
  userId: string | null;
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

  /**
   * Short handle the customer shows at the exit, e.g. `K7F2QM`.
   *
   * Typed by staff rather than scanned: a till has a keyboard and reliably has no camera,
   * and a code read off a customer's phone screen under shop lighting has to survive being
   * read aloud. The alphabet excludes O/0 and I/1 for the same reason.
   */
  verificationCode: string | null;

  /** User id of the staff member who confirmed the payment. Null until verified. */
  verifiedBy: string | null;
  verifiedAt: number | null;

  /**
   * What the scale at the exit actually read, in grams. Null when no reading was taken
   * — a branch without a scale is a legitimate configuration, and the payment check
   * stands on its own.
   */
  observedWeightGrams: number | null;
  weightCheckedBy: string | null;
  weightCheckedAt: number | null;
  /**
   * Set when the reading disagreed with the basket and staff approved anyway.
   *
   * Non-null is the audit trail: it names who decided a mismatched basket could leave.
   * Baskets disagree for innocent reasons often enough that blocking outright would
   * strand paying customers, so the override exists — and is attributable, which is
   * what keeps it from being the same thing as no check at all.
   */
  weightOverrideBy: string | null;

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

/**
 * `storeId` on the read methods is **routing information, not an access control input**.
 *
 * When each branch hosts its own database there is no single endpoint that can answer
 * "give me order X" — the id alone does not say which system holds it. Callers already
 * have the store on the signed session (`SessionPayload.sid`), so passing it costs nothing
 * and is the only way an order lookup can reach the right branch.
 *
 * Optional, because the memory and Postgres repositories hold every store in one place and
 * have no use for it, and a retailer running one central API does not need it either.
 * Authorisation still comes from `sessionId`, which is taken from the signed token and
 * re-checked against the record that comes back.
 */
export interface OrderRepository {
  create(order: Omit<OrderRecord, 'id'>): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  /** Scoped by session so one customer can never read another's order. */
  findForSession(sessionId: string, orderId: string, storeId?: string): Promise<OrderRecord | null>;
  markPaid(
    id: string,
    confirmation: PaymentConfirmation,
    storeId?: string
  ): Promise<OrderRecord | null>;

  /**
   * The order a member of staff is holding a code for.
   *
   * Scoped by store: a code typed at Trichy must never resolve an order from Thanjavur.
   * Codes are short enough to collide across a chain over time, and "it found *an* order"
   * is not the same as "it found the right one".
   */
  findByVerificationCode(storeId: string, code: string): Promise<OrderRecord | null>;

  /**
   * Records a staff confirmation. Returns null if the order moved on in the meantime.
   *
   * `verifiedBy` is a user id rather than a name, so "who opened the gate for an order that
   * was never paid" stays answerable after that person has left.
   */
  markVerified(id: string, verifiedBy: string, at: number): Promise<OrderRecord | null>;

  /**
   * A signed-in customer's own bills, newest first.
   *
   * Scoped by `userId` and nothing else — this is an ownership query, not a routing one,
   * and the id comes from the signed account cookie rather than from any parameter.
   */
  listForUser(userId: string, limit: number): Promise<OrderRecord[]>;

  /**
   * Writes the scale reading taken at the exit.
   *
   * Separate from `markVerified` because the two answer different questions — did the
   * money arrive, and does the basket match — and a branch may do one without the
   * other. Keeping them apart means a shop with no scale is a missing row rather than
   * a special case threaded through the payment path.
   */
  recordWeightCheck(input: {
    orderId: string;
    observedGrams: number;
    checkedBy: string;
    at: number;
    overrodeBy: string | null;
  }): Promise<void>;
}

/**
 * The weight-check fields of an order nobody has weighed yet.
 *
 * Every order starts here — the scale reading happens at the exit, long after the record
 * is created — so this is spread at creation rather than repeated at each call site.
 */
export const NO_WEIGHT_CHECK = {
  observedWeightGrams: null,
  weightCheckedBy: null,
  weightCheckedAt: null,
  weightOverrideBy: null,
} as const;
