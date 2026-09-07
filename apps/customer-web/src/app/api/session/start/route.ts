import { NextResponse, type NextRequest } from 'next/server';
import { validateEntryQr } from '@/server/qr';
import { getEgressIp, verifyNetworkPresence } from '@/server/network';
import { checkGeofence, type DevicePosition } from '@/server/stores/geofence';
import { createSession } from '@/server/session';
import { getStore } from '@/server/stores';
import { consumeToken } from '@/server/rateLimit';
import { recordEvent } from '@/server/analytics';

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
  const limit = await consumeToken(throttleKey, 10, 0.5);
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
  const qr = await validateEntryQr(body.qr_token);
  if (!qr.valid) {
    return fail(401, `qr_${qr.reason}`, qrFailureMessage(qr.reason));
  }

  const store = await getStore(qr.payload.sid);
  if (!store || !store.isActive) {
    return fail(401, 'qr_unknown_store', 'This entrance code is not recognised.');
  }

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

  // ---- Presence factor 3: proximity ----
  //
  // Checked after the network, and deliberately weaker than it. The position is supplied by
  // the browser, so anyone with developer tools can claim to be standing at the till — this
  // narrows the honest cases, it does not stop the dishonest ones. The Wi-Fi check above is
  // the control that holds, because the server observes the egress IP on the connection
  // itself and the page cannot assert it.
  //
  // A verdict of `null` — unsurveyed branch, no position offered, or a reading whose own
  // accuracy is worse than the fence — defers rather than refuses. A phone inside a concrete
  // supermarket routinely reports ±30 m or worse, and turning away a customer standing at
  // the entrance because their GPS is vague would be the app's fault, not theirs.
  const fence = checkGeofence(store, readPosition(body));

  if (fence.inside === false) {
    return fail(
      403,
      'outside_store',
      `You appear to be about ${fence.distanceM} m from ${store.name}. ` +
        `Move inside the shop and scan the code again.`
    );
  }

  const session = createSession(store.id, presence.egressIp);

  // Footfall. This is the only place a session can be created, so it is the only place
  // that can count one — and the count is of *verified* entries, since both presence
  // factors have already passed by the time execution reaches here.
  recordEvent({
    storeId: store.id,
    sessionId: session.sessionId,
    kind: 'session_started',
    occurredAt: Date.now(),
  });

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

/**
 * The device position, if the browser offered one.
 *
 * Every field is validated rather than trusted: this arrives from a client, and a latitude
 * of 200 or an accuracy of `-1` would otherwise reach the distance calculation and produce
 * a confident, meaningless answer.
 */
function readPosition(body: unknown): DevicePosition | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { position?: unknown }).position;
  if (typeof raw !== 'object' || raw === null) return null;

  const { latitude, longitude, accuracyM } = raw as Record<string, unknown>;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return null;
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracyM:
      typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM >= 0
        ? accuracyM
        : undefined,
  };
}
