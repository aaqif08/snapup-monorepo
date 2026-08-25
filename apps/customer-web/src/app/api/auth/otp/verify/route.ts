import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { verifyOtp } from '@/server/accounts/otp';
import { normalisePhone } from '@/server/accounts/phone';
import { otpRepository, userRepository } from '@/server/accounts/repository';
import {
  createAccountToken,
  isSecureRequest,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step two: exchange a one-time code for an account session.
 *
 * ## Sign-up and sign-in are the same request
 *
 * There is no separate customer registration. A number that verifies and has no account
 * gets one; a number that verifies and has an account signs in to it. That is not a
 * shortcut — splitting them would mean the *request* endpoint had to say whether an
 * account exists in order to route the caller to the right screen, which is precisely the
 * enumeration oracle that endpoint refuses to be.
 *
 * ## Failures are deliberately indistinguishable
 *
 * `verifyOtp` separates "no challenge", "expired", "burnt" and "wrong code" so the server
 * log can say what happened. The response collapses them, because the difference between
 * "wrong code" and "no challenge" tells an attacker whether a number is mid-login.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  // Tighter than the request limiter: this is the endpoint a brute-forcer would hammer.
  // The per-challenge attempt cap is the real defence; this stops one client spreading
  // guesses across many numbers to stay under it.
  const perIp = await consumeToken(`otp-verify:ip:${ip}`, 10, 1 / 6);
  if (!perIp.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
      'retry-after': String(perIp.retryAfterSeconds),
    });
  }

  let body: { phone?: unknown; code?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const phone = typeof body.phone === 'string' ? normalisePhone(body.phone) : null;
  if (!phone) return fail(400, 'invalid_phone', 'That does not look like a valid mobile number.');

  if (typeof body.code !== 'string' || !/^\d{4,8}$/.test(body.code.trim())) {
    return fail(400, 'invalid_code', 'Enter the code we sent you.');
  }

  const verdict = await verifyOtp(otpRepository, phone, body.code.trim());
  if (!verdict.ok) {
    console.warn(`[auth] OTP verification failed for ${phone}: ${verdict.reason}`);
    return fail(401, 'invalid_code', 'That code is not right, or it has expired. Request a new one.');
  }

  let user = await userRepository.findByPhone(phone);

  if (!user) {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    user = await userRepository.create({
      role: 'customer',
      phone,
      email: null,
      passwordHash: null,
      name: name ? name.slice(0, 80) : null,
      storeId: null,
      isActive: true,
    });
  } else if (!user.isActive) {
    // A deactivated account holds the number, so it cannot simply be recreated. Told
    // plainly: this is a support conversation, not something a retry will fix.
    return fail(403, 'account_disabled', 'This account has been disabled. Please contact support.');
  }

  await userRepository.recordLogin(user.id, Date.now());

  const response = NextResponse.json(
    { user: toPublicUser({ ...user, lastLoginAt: Date.now() }) },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );

  // No expiry: the account session lasts until an explicit logout. Safe because it grants
  // identity only — the catalogue still needs a shopping session, which is IP-bound and
  // capped at 30 minutes. See `server/accounts/session.ts`.
  setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  return response;
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
