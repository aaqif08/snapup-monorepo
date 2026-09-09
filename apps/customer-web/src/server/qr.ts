import 'server-only';
import { QR_SIGNING_SECRET, QR_TTL_SECONDS } from './env';
import { randomNonce, signPayload, verifyPayload } from './crypto';
import { createHmac } from 'crypto';
import { listStoresForPosterLookup } from './stores';
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


/**
 * The code printed on a poster: eight characters, derived rather than stored.
 *
 * ## Why not the signed token
 *
 * The first version of the poster printed the whole signed token in the URL — 240
 * characters, which is a version-11 QR of 61x61 modules. Rendered at 200px that is barely
 * three pixels per module, and the in-app scanner crops to the middle 60% of the frame and
 * decodes at 400px, so by the time the code reaches the decoder each module is about a
 * pixel and a half. It did not scan, and "it did not scan" is indistinguishable from a
 * broken camera to whoever is holding the phone.
 *
 * This is 8 characters. The whole URL is around 66, which is a version-4 QR of 33x33 —
 * roughly four times fewer modules over the same paper, and comfortably readable.
 *
 * ## Why derived and not random
 *
 * A random code would need a column, a migration and a lookup table. This is an HMAC of the
 * store id under the QR secret, so it is stable, needs no storage, and cannot be guessed
 * for a store you do not already have a code for — knowing `store_3` does not let you
 * compute its poster code without the secret.
 *
 * Crockford's alphabet without I, L, O and U: the code gets read aloud down a phone line
 * when a poster is damaged, and 0/O and 1/I/L are where that goes wrong.
 */
const POSTER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function posterCodeFor(storeId: string): string {
  const mac = createHmac('sha256', QR_SIGNING_SECRET).update(`poster:${storeId}`).digest();

  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += POSTER_ALPHABET[mac[i] % POSTER_ALPHABET.length];
  }
  return code;
}

/**
 * Resolves a printed code back to a store, by recomputing every active store's code and
 * comparing. Linear in the number of shops, which for this pilot is three and for any
 * realistic chain is small enough that a lookup table would be premature.
 *
 * Case-insensitive: someone typing a code off a damaged poster should not have to guess.
 */
export async function storeIdForPosterCode(code: string): Promise<string | null> {
  const wanted = code.trim().toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(wanted)) return null;

  for (const store of await listStoresForPosterLookup()) {
    if (posterCodeFor(store.id) === wanted) return store.id;
  }
  return null;
}
