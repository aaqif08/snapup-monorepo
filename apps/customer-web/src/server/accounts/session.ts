import 'server-only';
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { ACCOUNT_SESSION_SECRET } from '../env';
import { randomNonce, signPayload, verifyPayload } from '../crypto';
import { userRepository } from './repository';
import type { PublicUser, Role, UserRecord } from './types';
import { atLeast } from './types';

/**
 * The account session: who you are signed in as.
 *
 * ## No expiry, by decision
 *
 * There is no `exp` claim and the cookie has no `Max-Age`. You stay signed in until you
 * tap Log out, across restarts and reboots.
 *
 * That is defensible because of what this token *is not*. It carries identity and nothing
 * else — it does not unlock a store catalogue, authorise a payment, or stand in for the
 * presence check. Those belong to the **shopping** session in `server/session.ts`, which
 * keeps its 30-minute cap and its IP binding precisely because it does grant those things.
 * Being signed in on the sofa gets you a store list and your past orders.
 *
 * Two consequences worth naming rather than discovering:
 *
 *   - A stolen device stays signed in. Mitigated by the account granting so little on its
 *     own, and by `isActive` being re-read from the database on **every** request — so
 *     deactivating an account in the console signs it out everywhere immediately, which is
 *     the lever an owner actually needs.
 *   - Rotating `SNAPUP_ACCOUNT_SECRET` signs everyone out. That is the global logout, and
 *     it is why this secret is separate from the shopping-session one: using it must not
 *     also drop every basket live on a shop floor.
 */

export const ACCOUNT_COOKIE = 'snapup_account';
export const ACCOUNT_TOKEN_VERSION = 1;

export interface AccountPayload {
  v: number;
  /** User id. */
  sub: string;
  /** Nonce, so two tokens for the same user are never byte-identical. */
  n: string;
  iat: number;
}

export function createAccountToken(userId: string): string {
  const payload: AccountPayload = {
    v: ACCOUNT_TOKEN_VERSION,
    sub: userId,
    n: randomNonce(8),
    iat: Math.floor(Date.now() / 1000),
  };
  return signPayload(payload, ACCOUNT_SESSION_SECRET);
}

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the token out of `document.cookie`, so an XSS bug cannot read it.
 * `sameSite: lax` blocks it from cross-site POSTs while still surviving a normal
 * navigation back into the app. No `maxAge` — see the note above; omitting it makes a
 * session cookie, so `expires` is set far out instead to make it persistent.
 */
function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    // Ten years. A literal "never" is not expressible, and a date this far out is a
    // clearer statement of intent than the largest value the type allows.
    expires: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
  };
}

export function setAccountCookie(response: NextResponse, token: string, secure: boolean): void {
  response.cookies.set(ACCOUNT_COOKIE, token, cookieOptions(secure));
}

export function clearAccountCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set(ACCOUNT_COOKIE, '', {
    ...cookieOptions(secure),
    expires: new Date(0),
    maxAge: 0,
  });
}

/** Whether the request arrived over TLS, so the cookie is not marked Secure on plain http. */
export function isSecureRequest(request: NextRequest): boolean {
  if (request.headers.get('x-forwarded-proto') === 'https') return true;
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export type AccountResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: 'absent' | 'invalid' | 'unknown_user' | 'deactivated' };

/**
 * Resolve the signed-in user.
 *
 * The account row is re-read on every call rather than trusted from the token. That is one
 * lookup per request, and it buys the property that matters: an owner who removes a staff
 * member in the console signs them out *now*, not whenever their token would have expired
 * — which, given there is no expiry, would be never.
 */
export async function readAccount(request: NextRequest): Promise<AccountResult> {
  const token = request.cookies.get(ACCOUNT_COOKIE)?.value;
  if (!token) return { ok: false, reason: 'absent' };

  const verified = verifyPayload<AccountPayload>(token, ACCOUNT_SESSION_SECRET);
  if (!verified.valid || verified.payload.v !== ACCOUNT_TOKEN_VERSION) {
    return { ok: false, reason: 'invalid' };
  }

  const user = await userRepository.findById(verified.payload.sub);
  if (!user) return { ok: false, reason: 'unknown_user' };
  if (!user.isActive) return { ok: false, reason: 'deactivated' };

  return { ok: true, user };
}

/** Resolve and require at least `minimum`. Returns null when the caller does not qualify. */
export async function requireRole(
  request: NextRequest,
  minimum: Role
): Promise<UserRecord | null> {
  const result = await readAccount(request);
  if (!result.ok) return null;
  return atLeast(result.user.role, minimum) ? result.user : null;
}

/** The projection every response uses. Never carries `passwordHash`. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    role: user.role,
    phone: user.phone,
    email: user.email,
    name: user.name,
    storeId: user.storeId,
    isActive: user.isActive,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}
