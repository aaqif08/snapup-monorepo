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
  image_url: string;
  /** Paise. Integer arithmetic only — see the note in useCartStore. */
  unit_price: number;
  expected_weight_grams: number;

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

export interface ProductRepository {
  findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null>;
  search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }>;
}
