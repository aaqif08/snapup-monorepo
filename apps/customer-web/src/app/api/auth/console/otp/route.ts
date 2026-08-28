import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { verifyOtp } from '@/server/accounts/otp';
import { normalisePhone } from '@/server/accounts/phone';
import { otpRepository, userRepository } from '@/server/accounts/repository';
import { atLeast } from '@/server/accounts/types';
import {
  createAccountToken,
  isSecureRequest,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign in to the console with a phone number and a one-time code.
 *
 * ## Why this is not the customer verify endpoint
 *
 * `/api/auth/otp/verify` treats sign-up and sign-in as one request: a number with no
 * account gets one, as a `customer`. That is right for a shopper — the alternative would
 * force the *request* endpoint to reveal whether an account exists — and wrong here.
 * Pointing the console at it would let anyone holding any mobile number create an account
 * by signing in, then meet a confusing refusal at the door, having left a junk record
 * behind on the way.
 *
 * So this one **never creates an account**. It authenticates an existing console account,
 * and a number with no such account is turned away with nothing written down.
 *
 * The code itself is requested from the shared `/api/auth/otp/request` endpoint. Only the
 * redemption differs, so only the redemption is duplicated.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  const perIp = await consumeToken(`console-otp:ip:${ip}`, 10, 1 / 6);
  if (!perIp.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
      'retry-after': String(perIp.retryAfterSeconds),
    });
  }

  let body: { phone?: unknown; code?: unknown };
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
    console.warn(`[auth] Console OTP verification failed for ${phone}: ${verdict.reason}`);
    return fail(401, 'invalid_code', 'That code is not right, or it has expired. Request a new one.');
  }

  const user = await userRepository.findByPhone(phone);

  // One message for "no account", "a shopper's account" and "not approved yet".
  //
  // Unlike the customer flow, the console is a closed set of colleagues, so there is no
  // enumeration concern strong enough to outweigh being useful — but there is also nothing
  // useful to add. Whoever is holding the phone either has console access or does not, and
  // in every one of these cases the next step is to talk to whoever runs the shop.
  if (!user || !atLeast(user.role, 'staff') || !user.isActive) {
    return fail(
      403,
      'no_console_account',
      'That number is not registered for the business console, or is waiting to be approved.'
    );
  }

  const response = NextResponse.json(
    { user: toPublicUser(user), via: 'otp' },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
  setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  return response;
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
