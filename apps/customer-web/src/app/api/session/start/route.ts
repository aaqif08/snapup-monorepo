import { NextResponse, type NextRequest } from 'next/server';
import { validateEntryQr } from '@/server/qr';
import { getEgressIp, verifyNetworkPresence } from '@/server/network';
import { createSession } from '@/server/session';
import { getStore } from '@/server/stores';
import { consumeToken } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SDPA: the only route that can mint a shopping session, and it does so only when BOTH
 * presence factors pass.
 *
 * Factor 1 — a validly signed, unexpired entrance QR for a known store.
 * Factor 2 — the request's server-observed egress IP falls inside that store's
 *            registered network range.
 *
 * Either factor alone is rejected, which is what the CTO's "QR only -> denied" and
 * "Wi-Fi only -> denied" validation cases exercise.
 */
export async function POST(request: NextRequest) {
  // Throttled by source IP: this endpoint is unauthenticated by nature (it is what
  // issues authentication), so it is the natural place to brute-force QR signatures.
  const throttleKey = `session-start:${getEgressIp(request) ?? 'unknown'}`;
  const limit = consumeToken(throttleKey, 10, 0.5);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many attempts.' } },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds), 'cache-control': 'no-store' } }
    );
  }

  let body: { qr_token?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  if (typeof body.qr_token !== 'string' || body.qr_token.length === 0) {
    return fail(400, 'malformed_request', 'qr_token is required.');
  }

  // ---- Presence factor 1: signed entrance QR ----
  const qr = validateEntryQr(body.qr_token);
  if (!qr.valid) {
    return fail(401, `qr_${qr.reason}`, qrFailureMessage(qr.reason));
  }

  const store = getStore(qr.payload.sid);
  if (!store) return fail(401, 'qr_unknown_store', 'This entrance code is not recognised.');

  // ---- Presence factor 2: store network ----
  const presence = verifyNetworkPresence(request, store);
  if (!presence.present) {
    // A valid QR presented from outside the store lands here. This is the exact case
    // the photographed-QR-at-home attack produces, and it is the reason factor 2 exists.
    return fail(
      403,
      'presence_not_verified',
      `Connect to the ${store.advertisedSsid} network inside ${store.name} to start shopping.`
    );
  }

  const session = createSession(store.id, presence.egressIp);

  return NextResponse.json(
    {
      session_token: session.token,
      session_id: session.sessionId,
      store: { id: store.id, name: store.name },
      expires_at: session.expiresAt,
      expires_in_seconds: session.expiresAt - Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

function qrFailureMessage(reason: string): string {
  switch (reason) {
    case 'expired':
      // The single most likely legitimate failure: the entrance display rotates the code
      // every couple of minutes, so a customer who scanned slowly sees this.
      return 'This entrance code has expired. Scan the current code on the store display.';
    case 'unknown_version':
      return 'Please update the Snap Up app to continue.';
    default:
      return 'This entrance code is not valid.';
  }
}
