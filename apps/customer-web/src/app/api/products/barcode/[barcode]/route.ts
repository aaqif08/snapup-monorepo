import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { productRepository, toPublicProduct } from '@/server/products';
import {
  BARCODE_RULE,
  isValidBarcode,
  normaliseBarcode,
} from '@/server/products/barcodeFormat';
import { recordEvent } from '@/server/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Single-product lookup — the R3 hot path, and the only way a customer can read product
 * data. There is deliberately no endpoint that returns the catalogue in bulk.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ barcode: string }> }) {
  const startedAt = performance.now();

  const guard = await guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const { barcode: rawBarcode } = await context.params;
  // Folded before validating and before the lookup, so one definition of the format
  // serves both — see `products/barcodeFormat.ts`.
  const barcode = normaliseBarcode(rawBarcode);
  if (!isValidBarcode(barcode)) {
    return NextResponse.json(
      { error: { code: 'invalid_barcode', message: BARCODE_RULE } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  // Store scoping comes from the signed session, never from a query parameter — a
  // client-supplied store_id would let anyone read any store's pricing.
  const product = await productRepository.findByBarcode(guard.session.sid, barcode);

  const lookupMs = Math.round((performance.now() - startedAt) * 100) / 100;

  if (!product) {
    // A miss is a catalogue gap, and catalogue gaps cost the shop sales: the customer is
    // standing in the aisle holding the item and the app cannot sell it to them. Recorded
    // so the owner gets a ranked list of exactly which barcodes to add.
    recordEvent({
      storeId: guard.session.sid,
      sessionId: guard.session.sub,
      kind: 'scan_missed',
      occurredAt: Date.now(),
      barcode,
    });

    return NextResponse.json(
      {
        error: { code: 'product_not_found', message: 'This item was not found in this store.' },
        lookup_ms: lookupMs,
      },
      { status: 404, headers: { 'cache-control': 'no-store', 'server-timing': `lookup;dur=${lookupMs}` } }
    );
  }

  // Aisle traffic, derived rather than declared: a customer who scans this item was
  // physically standing where it is shelved. `aisle` is the operator-mapped location when
  // one exists, falling back to category — which in a supermarket is close enough to be
  // useful ("Dairy", "Beverages") without asking anyone to survey the shop first.
  recordEvent({
    storeId: guard.session.sid,
    sessionId: guard.session.sub,
    kind: 'product_scanned',
    occurredAt: Date.now(),
    productId: product.id,
    productName: product.name,
    aisle: product.aisle ?? product.category,
  });

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
