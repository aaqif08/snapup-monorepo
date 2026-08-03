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
export interface PublicProduct {
  id: string;
  barcode: string;
  name: string;
  unit_price: number;
  image_url: string;
  expected_weight_grams: number;
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
