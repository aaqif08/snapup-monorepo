import 'server-only';
import type { NextRequest } from 'next/server';
import { SESSION_SIGNING_SECRET, SESSION_TTL_SECONDS, PRESENCE_DEV_BYPASS } from './env';
import { randomNonce, signPayload, verifyPayload } from './crypto';
import { getEgressIp, ipMatchesCidr } from './network';
import { getStore } from './stores';

export const SESSION_TOKEN_VERSION = 1;

export interface SessionPayload {
  v: number;
  /** Session id — the correlation key used in presence logs. */
  sub: string;
  /** Store the session is scoped to. All product access is confined to this store. */
  sid: string;
  /**
   * The egress IP observed when both presence factors passed. Every later request must
   * still arrive from this IP.
   *
   * Binding the IP into the *signature* is what makes "database access is revoked the
   * moment the customer leaves the store" work without any server-side session store.
   * When they step onto cellular data their egress IP changes, the bound IP no longer
   * matches, and every subsequent API call is rejected. Nothing has to expire or be
   * actively cleaned up, which matters because serverless instances share no memory.
   */
  ip: string;
  iat: number;
  exp: number;
}

/**
 * Explicitly-ended sessions. This is a best-effort optimisation only: serverless
 * instances do not share memory, so a revoked token may still be unknown to another
 * instance. It is not the security boundary — the IP binding and the 30-minute
 * expiry are, and both hold regardless of which instance serves the request.
 */
const revokedSessions = new Set<string>();

export function createSession(storeId: string, egressIp: string) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;

  const payload: SessionPayload = {
    v: SESSION_TOKEN_VERSION,
    sub: `sess_${randomNonce(12)}`,
    sid: storeId,
    ip: egressIp,
    iat: now,
    exp,
  };

  return {
    token: signPayload(payload, SESSION_SIGNING_SECRET),
    sessionId: payload.sub,
    expiresAt: exp,
  };
}

export function revokeSession(sessionId: string): void {
  revokedSessions.add(sessionId);
}

export type SessionFailure =
  | 'missing_token'
  | 'malformed'
  | 'bad_signature'
  | 'unknown_version'
  | 'expired'
  | 'revoked'
  | 'unknown_store'
  | 'presence_lost';

export type SessionValidation =
  | { valid: true; payload: SessionPayload; expiresInSeconds: number }
  | { valid: false; reason: SessionFailure };

/**
 * Continuous presence validation. Run on every authenticated request, not just on a
 * heartbeat — a heartbeat alone would leave a window in which a customer who has left
 * the store can still read the database.
 */
export function validateSession(request: NextRequest, token: string | null): SessionValidation {
  if (!token) return { valid: false, reason: 'missing_token' };

  const result = verifyPayload<SessionPayload>(token, SESSION_SIGNING_SECRET);
  if (!result.valid) return { valid: false, reason: result.reason };

  const payload = result.payload;
  if (payload.v !== SESSION_TOKEN_VERSION) return { valid: false, reason: 'unknown_version' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  if (revokedSessions.has(payload.sub)) return { valid: false, reason: 'revoked' };

  const store = getStore(payload.sid);
  if (!store) return { valid: false, reason: 'unknown_store' };

  if (!PRESENCE_DEV_BYPASS) {
    const currentIp = getEgressIp(request);

    // Still the same device on the same network?
    if (!currentIp || currentIp !== payload.ip) {
      return { valid: false, reason: 'presence_lost' };
    }

    // Re-check against the store registry too, so revoking a store's authorization
    // takes effect on in-flight sessions instead of waiting up to 30 minutes.
    const stillAuthorized = store.authorizedEgressCidrs.some((cidr) =>
      ipMatchesCidr(currentIp, cidr)
    );
    if (!stillAuthorized) return { valid: false, reason: 'presence_lost' };
  }

  return { valid: true, payload, expiresInSeconds: payload.exp - now };
}

export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
