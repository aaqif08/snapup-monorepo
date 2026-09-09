import 'server-only';
import { QR_SIGNING_SECRET, QR_TTL_SECONDS } from './env';
import { randomNonce, signPayload, verifyPayload } from './crypto';
import { getStore } from './stores';

/** Bumped if the payload shape changes, so old signed QRs are rejected rather than misread. */
export const QR_TOKEN_VERSION = 1;

/**
 * How the code reached the shopper.
 *
 * `display` is the rotating code on a screen by the door; `poster` is printed on paper and
 * lives for as long as the paper does. A token with no `k` predates this field and is a
 * display token, which is why the check below treats `undefined` as `display` rather than
 * rejecting it.
 */
export type QrKind = 'display' | 'poster';

export interface QrPayload {
  v: number;
  /** Store identifier. */
  sid: string;
  /** Session initialization token — the nonce the entrance display rotates. */
  nonce: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiration timestamp, epoch seconds. */
  exp: number;
  /** Absent on tokens issued before printed posters existed; those are all `display`. */
  k?: QrKind;
}

/**
 * Issues the dynamic entrance QR. The store's entrance display re-requests this on an
 * interval; each code is only valid for QR_TTL_SECONDS, which is what makes a
 * photographed QR worthless later on.
 */
export function issueEntryQr(storeId: string): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + QR_TTL_SECONDS;

  const payload: QrPayload = {
    v: QR_TOKEN_VERSION,
    sid: storeId,
    nonce: randomNonce(),
    iat: now,
    exp,
  };

  return { token: signPayload(payload, QR_SIGNING_SECRET), expiresAt: exp };
}

/** Two years. Long enough that a printed poster outlives the pilot, short enough to expire. */
export const POSTER_TTL_SECONDS = 730 * 24 * 60 * 60;

/**
 * Issues the code that goes on a printed poster.
 *
 * ## This is deliberately weaker than the display code, and the difference matters
 *
 * The rotating entrance code is worth something precisely because it dies in two minutes:
 * photograph it from the car park and it is useless before you have parked. A printed code
 * cannot do that. It is on paper, it is public, and it is valid for as long as the paper is
 * on the wall — so anyone who has ever seen the poster holds presence factor 1 for ever.
 *
 * That leaves **the store network as the only factor that still discriminates**, which the
 * rest of this system already treats as the one that actually holds — the egress IP is
 * observed on the connection and a page cannot assert it. The geofence narrows it further
 * for honest devices. So a poster does not open the shop to the internet; it opens it to
 * whoever is already on the shop's Wi-Fi, which is a much smaller set and the one the
 * network check was written for.
 *
 * It is still a reduction, and it is a choice rather than an accident: a poster costs
 * nothing and needs no tablet, power or network at the door. Shops that can run a display
 * should use `/entrance/[storeId]` instead and get both factors.
 *
 * The token is signed, so it is not merely a store id in a URL: nobody can point a printed
 * code at a different shop, which is the property `/enter` cares about.
 */
export function issuePosterQr(storeId: string): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + POSTER_TTL_SECONDS;

  const payload: QrPayload = {
    v: QR_TOKEN_VERSION,
    sid: storeId,
    nonce: randomNonce(),
    iat: now,
    exp,
    k: 'poster',
  };

  return { token: signPayload(payload, QR_SIGNING_SECRET), expiresAt: exp };
}

export type QrValidation =
  | { valid: true; payload: QrPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'unknown_version' | 'unknown_store' };

export async function validateEntryQr(token: string): Promise<QrValidation> {
  const result = verifyPayload<QrPayload>(token, QR_SIGNING_SECRET);
  if (!result.valid) return { valid: false, reason: result.reason };

  const payload = result.payload;

  if (payload.v !== QR_TOKEN_VERSION) return { valid: false, reason: 'unknown_version' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  // An inactive store is treated as unknown here: a store that has been switched off must
  // not mint new sessions, and the customer gains nothing from the distinction.
  const store = payload.sid ? await getStore(payload.sid) : null;
  if (!store || !store.isActive) return { valid: false, reason: 'unknown_store' };

  return { valid: true, payload };
}
