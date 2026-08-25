import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { issueOtp, OTP_TTL_MS } from '@/server/accounts/otp';
import { maskPhone, normalisePhone } from '@/server/accounts/phone';
import { otpRepository } from '@/server/accounts/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step one of customer sign-in: send a one-time code to a phone number.
 *
 * ## This endpoint deliberately tells you nothing
 *
 * It answers identically whether or not an account exists for the number. Anything else
 * turns it into a lookup service for "does this person shop here" — answerable by anyone,
 * about anyone, with no credential at all. Account creation therefore happens on *verify*,
 * once the person has proved they hold the number, rather than here.
 *
 * ## Two rate limits, not one
 *
 * Per phone, because otherwise this is a free SMS cannon pointed at any number you choose,
 * billed to us and experienced as harassment by them. Per IP, because otherwise one client
 * can walk the number space issuing codes.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  // 5 requests, refilling at 1 per 12s. Enough for a genuine resend or two, far short of
  // enough to be useful as a bulk sender.
  const perIp = await consumeToken(`otp-request:ip:${ip}`, 5, 1 / 12);
  if (!perIp.allowed) return throttled(perIp.retryAfterSeconds);

  let body: { phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  if (typeof body.phone !== 'string') {
    return fail(400, 'invalid_phone', 'Enter your mobile number.');
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    return fail(400, 'invalid_phone', 'That does not look like a valid mobile number.');
  }

  // 3 codes per number per 15 minutes.
  const perPhone = await consumeToken(`otp-request:phone:${phone}`, 3, 1 / 300);
  if (!perPhone.allowed) {
    return fail(
      429,
      'too_many_requests',
      'Too many codes requested for this number. Try again in a few minutes.',
      { 'retry-after': String(perPhone.retryAfterSeconds) }
    );
  }

  let delivery: 'sms' | 'log';
  let devCode: string | undefined;
  try {
    const issued = await issueOtp(otpRepository, phone);
    delivery = issued.delivery;
    // Returned ONLY in log-delivery mode, which is refused in production. Without this the
    // flow cannot be exercised on a laptop with no SMS account; with it in production the
    // OTP would be pointless, which is why `OTP_DELIVERY` defaults to `sms` there.
    if (delivery === 'log') devCode = issued.code;
  } catch (error) {
    // The most likely cause is `SNAPUP_OTP_DELIVERY=sms` with no provider wired up. That
    // is an operator error and it must be loud in the log, but the customer just sees that
    // it did not send — they cannot fix our configuration.
    console.error(`[auth] could not issue an OTP for ${maskPhone(phone)}:`, error);
    return fail(503, 'delivery_failed', 'We could not send a code right now. Please try again.');
  }

  return NextResponse.json(
    {
      sent: true,
      phone_masked: maskPhone(phone),
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
      delivery,
      ...(devCode ? { dev_code: devCode } : {}),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

function throttled(retryAfterSeconds: number) {
  return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
    'retry-after': String(retryAfterSeconds),
  });
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
