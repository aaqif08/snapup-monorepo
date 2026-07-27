import 'server-only';
import type { InternalProduct, PublicProduct } from './types';

/**
 * The single point at which an internal product becomes customer-visible data.
 *
 * This is an allowlist by construction — fields are copied out one at a time rather
 * than spread-and-deleted. A `{ ...product, cost_price: undefined }` style projection
 * leaks every new column somebody adds to the table later; this one cannot, because a
 * new field is simply never copied.
 *
 * Every route that returns product data must route through here.
 */
export function toPublicProduct(product: InternalProduct): PublicProduct {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    unit_price: product.unit_price,
    image_url: product.image_url,
    expected_weight_grams: product.expected_weight_grams,
  };
}
