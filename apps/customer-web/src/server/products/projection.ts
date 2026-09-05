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

    // Added per the bill generation guide's list of fields that are safe to expose.
    // Its counterpart list — taxable_value, cgst_amount, sgst_amount, cgst_rate,
    // sgst_rate and gst_hsn_code — is the retailer's compliance record for GSTR filings
    // and is deliberately absent here. Those columns are not withheld because they are
    // secret; they are withheld because a customer-facing store has no use for them and
    // every field that leaves the server is a field somebody can build on.
    brand: product.brand ?? null,
    mrp_paise: product.mrp_paise ?? null,
    discount_paise: product.discount_paise ?? 0,
    /** GST already inside `unit_price`. Shown on the bill; never added to it. */
    gst_amount_paise: product.gst_amount_paise ?? 0,
    gst_rate_bp: product.gst_rate_bp ?? null,
  };
}
