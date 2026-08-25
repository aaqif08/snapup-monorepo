import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { RESET_DELIVERY, RESET_LINK_BASE } from '../env';
import { maskEmail } from './mask';
import type { PasswordReset, PasswordResetRepository, UserRecord } from './types';

/**
 * Password reset for console accounts.
 *
 * ## The token
 *
 * 32 random bytes, base64url. That is 256 bits — there is no guessing it, which is why
 * this needs no attempt counter and no pepper, unlike the six-digit OTP. What it does need
 * is to be **hashed at rest**: a live reset row is a credential capable of taking over an
 * owner account, and a plaintext one hands that to anyone who can read the table.
 *
 * ## The hour
 *
 * Long enough to find the message, short enough that a link left sitting in an inbox is
 * not a standing key to the console. Existing resets for the user are invalidated when a
 * new one is issued and again when one is consumed, so there is never more than one live
 * link and a used link cannot be replayed.
 *
 * ## What resetting does *not* do
 *
 * It does not sign the user in. The reset sets a password and nothing else; they then log
 * in with it normally. Auto-signing-in from a link in an inbox means anyone who reaches
 * that inbox — or that link in a proxy log — is inside the console with no second step.
 */

export const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function tokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssuedReset {
  reset: PasswordReset;
  /** The plaintext token. Never persisted; only used to build the link. */
  token: string;
  link: string;
  delivery: 'email' | 'log';
}

/**
 * Create a reset and deliver it.
 *
 * Any outstanding reset for the user is invalidated first, so somebody who taps the link
 * twice is never choosing between two live tokens — the newest always wins.
 */
export async function issueReset(
  repository: PasswordResetRepository,
  user: UserRecord,
  requestedIp: string | null
): Promise<IssuedReset> {
  await repository.invalidateFor(user.id);

  const token = randomBytes(32).toString('base64url');
  const now = Date.now();

  const reset = await repository.create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: now + RESET_TTL_MS,
    usedAt: null,
    createdAt: now,
    requestedIp,
  });

  const link = `${RESET_LINK_BASE}/reset-password?token=${encodeURIComponent(token)}`;
  const delivery = await deliver(user, link);

  return { reset, token, link, delivery };
}

/**
 * Delivery, with the seam where a mail provider goes.
 *
 * Unimplemented rather than faked, exactly as the SMS path is. A stub that returned
 * success would mean a pilot where nobody can recover an account and nothing says so.
 */
async function deliver(user: UserRecord, link: string): Promise<'email' | 'log'> {
  if (RESET_DELIVERY === 'email') {
    throw new Error(
      'SNAPUP_RESET_DELIVERY=email but no mail provider is configured. Wire one up in accounts/reset.ts.'
    );
  }

  console.info(`[reset] link for ${maskEmail(user.email)} — valid 1 hour:\n  ${link}`);
  return 'log';
}

export type ResetVerdict =
  | { ok: true; reset: PasswordReset }
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used' };

/**
 * Check a submitted token.
 *
 * The reasons are distinguished for the log and collapsed by the route: telling an
 * anonymous caller the difference between "no such token" and "that token expired"
 * confirms which tokens have existed.
 */
export async function verifyReset(
  repository: PasswordResetRepository,
  token: string
): Promise<ResetVerdict> {
  const candidate = hashToken(token);
  const reset = await repository.findByTokenHash(candidate);

  if (!reset) return { ok: false, reason: 'unknown' };
  // Redundant against the lookup, which already matched on the hash — kept because the
  // lookup is a repository concern and this is the security boundary. If a future
  // implementation ever does a looser match, this is what still holds.
  if (!tokensMatch(reset.tokenHash, candidate)) return { ok: false, reason: 'unknown' };
  if (reset.usedAt !== null) return { ok: false, reason: 'already_used' };
  if (reset.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, reset };
}
