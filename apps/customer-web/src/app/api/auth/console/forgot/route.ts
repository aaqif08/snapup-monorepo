import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { maskEmail } from '@/server/accounts/mask';
import { issueReset, RESET_TTL_MS } from '@/server/accounts/reset';
import { passwordResetRepository, userRepository } from '@/server/accounts/repository';
import { isStaffRole } from '@/server/accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step one of password recovery: send a reset link.
 *
 * ## This endpoint always says the same thing
 *
 * Whether the address has an account, has a *customer* account with no password, or has
 * never been seen, the response is identical. Anything else makes this a free tool for
 * discovering who works at Kurinji — and unlike a login form, it needs no password guess
 * to be useful.
 *
 * The masked address in the response is echoed from what the **caller typed**, not from
 * anything stored, so it confirms a typo without confirming an account.
 *
 * ## Customers are not eligible, and that is not a gap
 *
 * A customer signs in with a phone and a one-time code. There is no password to reset, so
 * there is no reset flow to abuse against the larger population — the recovery path simply
 * does not exist for them.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  // 4 per IP per 10 minutes. This endpoint sends mail on demand; without a limit it is a
  // way to bury someone's inbox, billed to us.
  const perIp = await consumeToken(`reset-request:ip:${ip}`, 4, 1 / 150);
  if (!perIp.allowed) {
    return fail(429, 'rate_limited', 'Too many requests. Please wait a few minutes.', {
      'retry-after': String(perIp.retryAfterSeconds),
    });
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Format is a property of what was typed, not of what exists, so rejecting it leaks
    // nothing and saves a pointless round trip.
    return fail(400, 'invalid_email', 'Enter a valid email address.');
  }

  // Also limited per address, so a distributed caller cannot spread the load above and
  // still flood one inbox.
  const perEmail = await consumeToken(`reset-request:email:${email.toLowerCase()}`, 3, 1 / 300);

  const user = await userRepository.findByEmail(email);
  const eligible = Boolean(user && isStaffRole(user.role) && user.isActive);

  if (eligible && perEmail.allowed && user) {
    try {
      await issueReset(passwordResetRepository, user, ip);
    } catch (error) {
      // A mail provider that is configured but broken is an operator problem. It is loud
      // in the log and invisible in the response — telling the caller that delivery failed
      // would confirm the account exists.
      console.error(`[reset] could not send a reset for ${maskEmail(user.email)}:`, error);
    }
  } else {
    console.info(`[reset] ignored request for ${maskEmail(email)} (no eligible account)`);
  }

  return NextResponse.json(
    {
      sent: true,
      email_masked: maskEmail(email),
      expires_in_seconds: Math.floor(RESET_TTL_MS / 1000),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
