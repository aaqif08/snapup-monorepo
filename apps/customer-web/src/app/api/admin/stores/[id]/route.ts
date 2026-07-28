import { NextResponse, type NextRequest } from 'next/server';
import { guardAdminRequest } from '@/server/adminAuth';
import { storeRepository } from '@/server/stores';
import { validateStoreDraft } from '@/server/stores/validation';
import { toAdminStore, warningsFor } from '@/server/stores/adminProjection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Edits a store — including deactivating it, which is how a store is withdrawn.
 *
 * There is no DELETE. Sessions, and later orders, reference a store by id, so removing
 * the row would strand them; `is_active: false` withdraws the store from the directory
 * and refuses new sessions while keeping the id resolvable. `validateSession()` re-reads
 * the registry on every request, so deactivating here also ends sessions already in
 * progress at that store rather than letting them run out their 30 minutes.
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

  const validated = validateStoreDraft(body, { partial: true });
  if (!validated.ok) return badRequest(validated.errors);

  if (Object.keys(validated.value).length === 0) {
    return badRequest(['No recognised fields to update.']);
  }

  const updated = await storeRepository.update(id, validated.value);
  if (!updated) {
    return NextResponse.json(
      { error: { code: 'store_not_found', message: 'No store with that id.' } },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { store: toAdminStore(updated), warnings: warningsFor(updated) },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

function badRequest(errors: string[]) {
  return NextResponse.json(
    { error: { code: 'invalid_store', message: errors.join(' ') }, errors },
    { status: 400, headers: { 'cache-control': 'no-store' } }
  );
}
