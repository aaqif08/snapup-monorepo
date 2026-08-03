import 'server-only';
import type { InternalProduct } from './types';

/**
 * Operator-facing view of a product.
 *
 * This deliberately includes the commercial fields `toPublicProduct()` withholds — cost
 * price, margin, supplier, stock, SKU. That is not a contradiction of Requirement 2:
 * the requirement is that *customers* never receive them, and this is the supermarket's
 * own console looking at the supermarket's own data.
 *
 * The distinction that keeps that safe is who is on the other end. `toPublicProduct()`
 * serves a shopper's phone over a presence-verified session; this serves the operator's
 * console behind the admin credential. They are different projections precisely so that
 * neither one has to carry a flag deciding how much to reveal — a flag being exactly the
 * kind of thing that gets passed the wrong way once and leaks everything.
 *
 * `purchase_history` is still withheld, because nothing in the console displays it and an
 * unbounded array on every row of a product list is payload nobody asked for.
 */
export function toAdminProduct(product: InternalProduct) {
  return {
    id: product.id,
    store_id: product.store_id,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    aisle: product.aisle ?? null,
    image_url: product.image_url,
    unit_price: product.unit_price,
    expected_weight_grams: product.expected_weight_grams,
    is_active: product.is_active,
    cost_price: product.cost_price,
    profit_margin_pct: product.profit_margin_pct,
    supplier_name: product.supplier_name,
    supplier_contact: product.supplier_contact,
    stock_quantity: product.stock_quantity,
    internal_sku: product.internal_sku,
  };
}

export type AdminProduct = ReturnType<typeof toAdminProduct>;

/** Non-blocking data-entry checks, surfaced in the console rather than rejected. */
export function productWarnings(product: { unit_price: number; cost_price: number }): string[] {
  const warnings: string[] = [];

  // Selling below cost is legitimate — loss leaders and clearance are real — so this
  // warns rather than refuses. It is also the single most common unit mix-up (rupees
  // typed where paise were expected), which is why it is worth saying out loud.
  if (product.cost_price > product.unit_price) {
    warnings.push(
      'Cost price is higher than the selling price, so every sale of this item loses money. Legitimate for a loss leader, but worth double-checking.'
    );
  }

  return warnings;
}
