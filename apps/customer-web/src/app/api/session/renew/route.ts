import { NextResponse, type NextRequest } from 'next/server';
import { createSession, extractBearerToken, validateSession } from '@/server/session';
import { verifyNetworkPresence } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { getStore } from '@/server/stores';
import { SESSION_TTL_SECONDS } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Silent session renewal, roughly one minute before expiry.
 *
 * ## What the client's timer is, and is not
 *
 * It is a trigger. Nothing else. The clock in the browser decides *when* to ask, and the
 * server decides entirely on its own whether to grant — by re-reading the presence factors
 * from the request in front of it. A customer who moves the device clock forward, edits the
 * stored expiry, or calls this endpoint in a loop gets the same answer as one who waits:
 * renewed if still on the shop's network, refused otherwise.
 *
 * This is why the endpoint takes no arguments. There is no store id to tamper with and no
 * expiry to claim — the store comes from the signature on the current session, and the
 * network comes from the connection. The only thing the caller supplies is the token they
 * already hold, which is exactly what they would need to keep shopping anyway.
 *
 * ## Why renewal exists at all
 *
 * The 30-minute limit is a presence control, not a shopping-time limit. A customer still
 * inside the shop with a trolley half full has not stopped being present, and making them
 * find the entrance QR again to prove it is a queue at the door for no security gain — the
 * check that matters, the network, is re-run here in full.
 *
 * ## What it will not do
 *
 * Extend a session that has already expired. At that point presence has not been confirmed
 * for an unknown interval, and quietly reviving it would turn a 30-minute window into an
 * indefinite one for anyone who closed their phone in the car park.
 */
export async function POST(request: NextRequest) {
  const validation = await validateSession(request, extractBearerToken(request));

  if (!validation.valid) {
    // Includes the expired case. A dead session is re-established by scanning the entrance
    // code, not by asking again.
    return NextResponse.json(
      { renewed: false, reason: validation.reason },
      { status: 200, headers: NO_STORE }
    );
  }

  const { sub: sessionId, sid: storeId } = validation.payload;

  // Renewal is idempotent in effect but not free: it mints a token and re-reads the store.
  // The cap is per session rather than per IP, because every shopper in the building shares
  // one egress address and a per-IP limit would have them starving each other.
  const limit = await consumeToken(`session-renew:${sessionId}`, 4, 1 / 60);
  if (!limit.allowed) {
    // Deliberately not an error to the customer. A client looping on renewal is a bug in
    // the client, and the correct behaviour is to keep shopping on the session they hold.
    console.warn(`[session] Renewal rate-limited for ${sessionId}`);
    return NextResponse.json(
      { renewed: false, reason: 'too_many_renewals', expires_at: validation.payload.exp },
      { status: 200, headers: NO_STORE }
    );
  }

  const store = await getStore(storeId);
  if (!store || !store.isActive) {
    console.warn(`[session] Renewal refused for ${sessionId}: store ${storeId} unavailable`);
    return NextResponse.json(
      { renewed: false, reason: 'store_unavailable' },
      { status: 200, headers: NO_STORE }
    );
  }

  // Presence, re-checked from scratch through the same helper `session/start` uses. This
  // is the whole point of the endpoint: the session is extended only because the customer
  // is *still* on the shop's network, and that is established here rather than inherited
  // from the token being renewed. Sharing the helper is what stops the entry gate and the
  // renewal gate drifting into two different definitions of "present".
  const presence = verifyNetworkPresence(request, store);

  if (!presence.present) {
    console.info(`[session] Renewal refused for ${sessionId}: presence not verified`);
    return NextResponse.json(
      { renewed: false, reason: 'presence_not_verified' },
      { status: 200, headers: NO_STORE }
    );
  }

  // A fresh session rather than a mutated expiry, because the expiry is inside a signature
  // and cannot be edited in place. The IP is re-bound to the address observed *now*, so a
  // renewal cannot carry an old binding forward.
  const renewed = createSession(storeId, presence.egressIp);

  console.info(
    `[session] Renewed ${sessionId} -> ${renewed.sessionId} at ${storeId} ` +
      `for another ${SESSION_TTL_SECONDS}s`
  );

  return NextResponse.json(
    {
      renewed: true,
      session_token: renewed.token,
      session_id: renewed.sessionId,
      expires_at: renewed.expiresAt,
      store: { id: store.id, name: store.name },
    },
    { status: 200, headers: NO_STORE }
  );
}

const NO_STORE = { 'cache-control': 'no-store' };
