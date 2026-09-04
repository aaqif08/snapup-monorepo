import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { verifyPasswordConstantTime } from '@/server/accounts/password';
import { userRepository } from '@/server/accounts/repository';
import {
  createAccountToken,
  isSecureRequest,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer sign-in — username and password.
 *
 * ## One message for every failure
 *
 * Unknown username, wrong password and deactivated account all return the same sentence.
 * Unlike registration — where the person is choosing a name and must be told it is taken —
 * there is nothing here a legitimate customer gains from the distinction, and separating
 * them turns this endpoint into a way to test whether a username exists.
 *
 * ## Why the password is verified even when the user is missing
 *
 * `verifyPasswordConstantTime` hashes against a decoy when no account matched, so a request
 * for an unknown username costs the same tenth of a second as one for a known username with
 * the wrong password. Without it the response time answers the question the error message
 * refuses to — scrypt is slow, and that slowness is exactly what leaks.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  const perIp = await consumeToken(`signin:ip:${ip}`, 10, 1 / 6);
  if (!perIp.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
      'retry-after': String(perIp.retryAfterSeconds),
    });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return fail(400, 'missing_credentials', 'Enter your username and password.');
  }

  // Per-username as well as per-IP. The IP limit alone is no defence against someone with a
  // proxy pool guessing one account's password; this is the one that protects the account.
  const perUser = await consumeToken(`signin:user:${username.toLowerCase()}`, 8, 1 / 30);
  if (!perUser.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts for that account. Please wait.', {
      'retry-after': String(perUser.retryAfterSeconds),
    });
  }

  const user = await userRepository.findByUsername(username);

  // Constant work whether or not the account exists — see the note above.
  const ok = await verifyPasswordConstantTime(password, user?.passwordHash ?? null);

  if (!user || !ok || !user.isActive) {
    console.warn(`[auth] Failed customer sign-in for "${username}" from ${ip}`);
    return fail(401, 'invalid_credentials', 'That username or password is not right.');
  }

  await userRepository.update(user.id, { lastLoginAt: Date.now() } as never).catch(() => {
    // A sign-in that worked must not fail because a timestamp did not write. The value is
    // for support and analytics, not for access control.
  });

  const response = NextResponse.json(
    { user: toPublicUser(user) },
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
