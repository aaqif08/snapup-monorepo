import 'server-only';

/**
 * The full internal product record, as the supermarket's own systems hold it.
 * Nothing in this shape is ever serialised to a customer — see `projection.ts`.
 */
export interface InternalProduct {
  id: string;
  store_id: string;
  barcode: string;
  name: string;
  category: string;

  /**
   * Physical shelf location, e.g. "Aisle 4 — Dairy".
   *
   * Optional, and the aisle-traffic report falls back to `category` when it is absent — so
   * a store gets useful location insight on day one and can refine it later by mapping real
   * aisles, rather than having to survey the whole shop before any of it works.
   */
  aisle?: string | null;

  image_url: string;
  /** Paise. Integer arithmetic only — see the note in useCartStore. */
  unit_price: number;

  /** Manufacturer's printed maximum, in paise. Null when the catalogue did not state one. */
  mrp_paise?: number | null;
  /**
   * Shelf promotion, in paise off `unit_price`. Applied to everybody.
   *
   * Not the Snap Up member benefit — that is the service-fee waiver, computed in
   * `pricing.ts`. This is the shop's own markdown, and the supplied catalogue carries
   * one on 448 of its 547 lines.
   */
  discount_paise?: number;
  brand?: string | null;

  /**
   * GST already contained in `unit_price`, in paise. Never added on top.
   *
   * Pre-computed by the retailer rather than derived from a rate here: their
   * `product_pricing` row carries this alongside the taxable value, CGST and SGST, and
   * all four have to agree for a GSTR filing. Recomputing one would eventually disagree
   * with the other three by a paisa, and the filing is the thing that has to be right.
   */
  gst_amount_paise?: number;
  /** Slab in basis points — 1800 is 18.00%. Optional badge on the item. */
  gst_rate_bp?: number | null;
  expected_weight_grams: number;

  /**
   * Withdrawn products stay in the table rather than being deleted, because orders
   * reference them by id. Inactive products are invisible to customers — excluded from
   * both barcode lookup and search — but still resolvable for the operator.
   */
  is_active: boolean;

  // ---- Commercially sensitive. Requirement 2 forbids exposing any of these. ----
  cost_price: number;
  profit_margin_pct: number;
  supplier_name: string;
  supplier_contact: string;
  stock_quantity: number;
  internal_sku: string;
  purchase_history: { date: string; qty: number; unit_cost: number }[];
}

/** Exactly the fields Requirement 2 permits a customer to receive. */
/**
 * What a customer's browser is allowed to see about a product.
 *
 * The bill generation guide divides the retailer's pricing row in two, and this is the
 * safe half. The other half — `taxable_value`, `cgst_amount`, `sgst_amount`, `cgst_rate`,
 * `sgst_rate`, `gst_hsn_code` — is the compliance record behind a GSTR filing and is
 * absent by construction: it is not on this type, so it cannot be added by accident in a
 * projection someone writes later.
 */
export interface PublicProduct {
  id: string;
  barcode: string;
  name: string;
  /** GST-inclusive, as every Indian retail price is. */
  unit_price: number;
  image_url: string;
  expected_weight_grams: number;

  brand: string | null;
  /** Printed maximum, for a struck-through 'was' price. Null when not stated. */
  mrp_paise: number | null;
  discount_paise: number;
  /** GST already inside `unit_price`. Shown on the bill; never added to it. */
  gst_amount_paise: number;
  /** Slab in basis points — 1800 is 18.00%. Optional badge. */
  gst_rate_bp: number | null;
}

export interface PageMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
}

/** Everything an operator supplies when adding a product. `id` is assigned by the store. */
export interface ProductDraft {
  store_id: string;
  barcode: string;
  name: string;
  category: string;
  aisle: string | null;
  image_url: string;
  unit_price: number;
  expected_weight_grams: number;
  cost_price: number;
  supplier_name: string;
  supplier_contact: string;
  stock_quantity: number;
  internal_sku: string;
  is_active: boolean;
}

export interface ProductRepository {
  /** Customer path: active products only. */
  findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null>;
  search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }>;

  /** Operator path: includes withdrawn products, since those still need managing. */
  listAllForStore(storeId: string): Promise<InternalProduct[]>;
  create(draft: ProductDraft): Promise<InternalProduct>;
  update(id: string, patch: Partial<ProductDraft>): Promise<InternalProduct | null>;
}
