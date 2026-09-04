import { NextResponse, type NextRequest } from 'next/server';
import { guardAdminRequest } from '@/server/adminAuth';
import { readAccount } from '@/server/accounts/session';
import { storeRepository } from '@/server/stores';
import { validateStoreDraft } from '@/server/stores/validation';
import { toAdminStore, warningsFor } from '@/server/stores/adminProjection';
import type { StoreDraft } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin view of the store registry.
 *
 * Unlike the customer directory this returns `authorizedEgressCidrs`, because registering
 * that value is the entire point of the screen — an admin who cannot see what a store's
 * network is set to cannot tell a misconfiguration from a working store. It is guarded by
 * `guardAdminRequest`, and the admin console holds its credential server-side.
 */
export async function GET(request: NextRequest) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  const stores = await storeRepository.listAll();

  return NextResponse.json(
    { stores: stores.map(toAdminStore) },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

/** Registers a new store. */
export async function POST(request: NextRequest) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(['Expected a JSON body.']);
  }

  // Who is making the change, from the signed account cookie. §8 asks for network

  // configuration changes to carry an actor, and an actor the client could supply

  // would be an actor the client could invent.

  const actor = await readAccount(request);

  const validated = validateStoreDraft(body, { partial: false });
  if (!validated.ok) return badRequest(validated.errors);

  const created = await storeRepository.create({
    ...(validated.value as StoreDraft),
    networkUpdatedBy: actor.ok ? actor.user.id : null,
  });

  return NextResponse.json(
    { store: toAdminStore(created), warnings: warningsFor(created) },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );
}

function badRequest(errors: string[]) {
  return NextResponse.json(
    { error: { code: 'invalid_store', message: errors.join(' ') }, errors },
    { status: 400, headers: { 'cache-control': 'no-store' } }
  );
}
