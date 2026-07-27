import { NextResponse, type NextRequest } from 'next/server';
import { extractBearerToken, validateSession } from '@/server/session';
import { getStore } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Continuous presence validation.
 *
 * The heartbeat is a UX affordance, not the security boundary — it lets the app tell the
 * customer "you've left the store, your session ended" instead of failing their next scan
 * with no explanation. Enforcement itself happens on every product request independently,
 * so skipping or blocking the heartbeat grants no extra access.
 */
export async function POST(request: NextRequest) {
  const validation = validateSession(request, extractBearerToken(request));

  if (!validation.valid) {
    return NextResponse.json(
      { active: false, reason: validation.reason },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  }

  const store = getStore(validation.payload.sid);

  return NextResponse.json(
    {
      active: true,
      session_id: validation.payload.sub,
      store: store ? { id: store.id, name: store.name } : null,
      expires_at: validation.payload.exp,
      expires_in_seconds: validation.expiresInSeconds,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
