import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { productRepository, toPublicProduct } from '@/server/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Barcodes are digits only (EAN/UPC). Validating up front keeps junk out of the index lookup. */
const BARCODE_PATTERN = /^\d{6,14}$/;

/**
 * Single-product lookup — the R3 hot path, and the only way a customer can read product
 * data. There is deliberately no endpoint that returns the catalogue in bulk.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ barcode: string }> }) {
  const startedAt = performance.now();

  const guard = guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const { barcode } = await context.params;
  if (!BARCODE_PATTERN.test(barcode)) {
    return NextResponse.json(
      { error: { code: 'invalid_barcode', message: 'Barcode must be 6-14 digits.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  // Store scoping comes from the signed session, never from a query parameter — a
  // client-supplied store_id would let anyone read any store's pricing.
  const product = await productRepository.findByBarcode(guard.session.sid, barcode);

  const lookupMs = Math.round((performance.now() - startedAt) * 100) / 100;

  if (!product) {
    return NextResponse.json(
      {
        error: { code: 'product_not_found', message: 'This item was not found in this store.' },
        lookup_ms: lookupMs,
      },
      { status: 404, headers: { 'cache-control': 'no-store', 'server-timing': `lookup;dur=${lookupMs}` } }
    );
  }

  return NextResponse.json(
    { product: toPublicProduct(product), lookup_ms: lookupMs },
    {
      status: 200,
      headers: {
        // Private, not public: this response is scoped to one store's pricing and one
        // customer's session, so it must never land in a shared/CDN cache. The short
        // max-age lets a re-scan of the same item inside one trip come from the browser
        // cache instead of the network (R3's "cached lookups are faster" case).
        'cache-control': 'private, max-age=60',
        'server-timing': `lookup;dur=${lookupMs}`,
      },
    }
  );
}
