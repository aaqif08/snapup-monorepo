import 'server-only';
import { QR_SIGNING_SECRET, QR_TTL_SECONDS } from './env';
import { randomNonce, signPayload, verifyPayload } from './crypto';
import { getStore } from './stores';

/** Bumped if the payload shape changes, so old signed QRs are rejected rather than misread. */
export const QR_TOKEN_VERSION = 1;

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

export type QrValidation =
  | { valid: true; payload: QrPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'unknown_version' | 'unknown_store' };

export function validateEntryQr(token: string): QrValidation {
  const result = verifyPayload<QrPayload>(token, QR_SIGNING_SECRET);
  if (!result.valid) return { valid: false, reason: result.reason };

  const payload = result.payload;

  if (payload.v !== QR_TOKEN_VERSION) return { valid: false, reason: 'unknown_version' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  if (!payload.sid || !getStore(payload.sid)) return { valid: false, reason: 'unknown_store' };

  return { valid: true, payload };
}
