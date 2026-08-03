import { NextResponse, type NextRequest } from 'next/server';
import { guardAdminRequest } from '@/server/adminAuth';
import { DuplicateBarcodeError, productRepository, toAdminProduct } from '@/server/products';
import { productWarnings } from '@/server/products/adminProjection';
import { validateProductDraft } from '@/server/products/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Edits a product, including withdrawing it via `is_active: false`.
 *
 * There is no DELETE, for the same reason the store registry has none: orders reference
 * products by id, and an order that cannot resolve what was bought is worse than a row
 * that outlives its usefulness. Withdrawal hides the product from customer lookup and
 * search while keeping it addressable by the operator.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(['Expected a JSON body.']);
  }

  const validated = validateProductDraft(body, { partial: true });
  if (!validated.ok) return badRequest(validated.errors);

  if (Object.keys(validated.value).length === 0) {
    return badRequest(['No recognised fields to update.']);
  }

  try {
    const updated = await productRepository.update(id, validated.value);
    if (!updated) {
      return NextResponse.json(
        { error: { code: 'product_not_found', message: 'No product with that id.' } },
        { status: 404, headers: { 'cache-control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { product: toAdminProduct(updated), warnings: productWarnings(updated) },
      { status: 200, headers: { 'cache-control': 'no-store' } }
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
