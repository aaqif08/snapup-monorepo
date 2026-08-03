import { NextResponse, type NextRequest } from 'next/server';
import { guardAdminRequest } from '@/server/adminAuth';
import { DuplicateBarcodeError, productRepository, toAdminProduct } from '@/server/products';
import { productWarnings } from '@/server/products/adminProjection';
import { validateProductDraft } from '@/server/products/validation';
import { getStore } from '@/server/stores';
import type { ProductDraft } from '@/server/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator view of one store's catalogue — including withdrawn products, which the
 * customer path hides but which still need managing.
 *
 * Store-scoped by required query parameter rather than returning everything: a catalogue
 * belongs to a store, and a console that mixed two stores' pricing into one list would
 * make it easy to edit the wrong one.
 */
export async function GET(request: NextRequest) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  const storeId = request.nextUrl.searchParams.get('store_id');
  if (!storeId) {
    return badRequest(['store_id is required.']);
  }

  const store = await getStore(storeId);
  if (!store) {
    return NextResponse.json(
      { error: { code: 'store_not_found', message: 'No store with that id.' } },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  const products = await productRepository.listAllForStore(storeId);

  return NextResponse.json(
    {
      store: { id: store.id, name: store.name },
      products: products.map(toAdminProduct),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(['Expected a JSON body.']);
  }

  const validated = validateProductDraft(body, { partial: false });
  if (!validated.ok) return badRequest(validated.errors);

  const draft = validated.value as ProductDraft;

  // A product for a store that does not exist would be unreachable by any customer, so
  // it is refused rather than quietly stored.
  if (!(await getStore(draft.store_id))) {
    return badRequest([`store_id ${draft.store_id} does not match a registered store.`]);
  }

  try {
    const created = await productRepository.create(draft);
    return NextResponse.json(
      { product: toAdminProduct(created), warnings: productWarnings(created) },
      { status: 201, headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof DuplicateBarcodeError) {
      return NextResponse.json(
        { error: { code: 'duplicate_barcode', message: error.message } },
        { status: 409, headers: { 'cache-control': 'no-store' } }
      );
    }
    throw error;
  }
}

function badRequest(errors: string[]) {
  return NextResponse.json(
    { error: { code: 'invalid_product', message: errors.join(' ') }, errors },
    { status: 400, headers: { 'cache-control': 'no-store' } }
  );
}
