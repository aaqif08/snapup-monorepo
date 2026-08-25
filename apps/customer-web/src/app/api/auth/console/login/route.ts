import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { randomNonce } from '@/server/crypto';
import { hashPassword, verifyPassword } from '@/server/accounts/password';
import { userRepository } from '@/server/accounts/repository';
import {
  createAccountToken,
  isSecureRequest,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';
import { isStaffRole } from '@/server/accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Console sign-in: email and password.
 *
 * Replaces a client-side mock that accepted **any** email with **any** six-character
 * password and assigned itself the `manager` role. That was a stand-in with no backend,
 * and it meant the store registry — including every branch's authorised network — was
 * editable by anyone who could open the login page.
 *
 * ## Every failure looks the same
 *
 * Unknown email, wrong password and deactivated account all return the same 401 with the
 * same message. Distinguishing them turns this into an account-enumeration oracle, and
 * "this email exists but you got the password wrong" is exactly the confirmation a
 * credential-stuffing run is looking for.
 *
 * The one exception is a *pending* account, which gets its own message. That is a
 * deliberate trade: a colleague who signed up and is waiting for approval will otherwise
 * conclude the system is broken and try again, and the information leaked — that an
 * account exists for an address the owner already knows about — is not worth the support
 * call.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  // 8 attempts, refilling at 1 per 10s. Slow enough to make online guessing useless,
  // generous enough to survive a few genuine typos.
  const limit = await consumeToken(`console-login:${ip}`, 8, 1 / 10);
  if (!limit.allowed) {
    return fail(429, 'rate_limited', 'Too many sign-in attempts. Please wait a moment.', {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return fail(400, 'missing_credentials', 'Enter your email and password.');
  }

  const user = await userRepository.findByEmail(email);

  // Hash even when there is no user, against a decoy. Otherwise an unknown email returns
  // in microseconds and a known one takes ~100 ms of scrypt, which is a timing oracle for
  // which addresses have accounts — the exact thing the shared error message above exists
  // to prevent.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await decoyHash()));

  if (!user || !ok || !isStaffRole(user.role)) {
    console.warn(`[auth] console sign-in refused for ${email} from ${ip}`);
    return fail(401, 'invalid_credentials', 'That email and password do not match.');
  }

  if (!user.isActive) {
    return fail(
      403,
      'pending_approval',
      'This account is waiting for an owner to approve it. Ask them to activate you in Staff management.'
    );
  }

  await userRepository.recordLogin(user.id, Date.now());

  const response = NextResponse.json(
    { user: toPublicUser({ ...user, lastLoginAt: Date.now() }) },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
  setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  return response;
}

/**
 * A real scrypt hash of a random value, so the no-such-user path costs the same scrypt
 * work as the wrong-password path.
 *
 * Computed lazily and memoised rather than written as a literal: a hash committed to a
 * repository is one somebody can precompute against, and generating it from
 * `randomNonce` means nobody — including us — knows the input.
 */
let decoy: Promise<string> | null = null;

function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomNonce(32));
  return decoy;
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
