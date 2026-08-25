import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { hashPassword, passwordProblem } from '@/server/accounts/password';
import { verifyReset } from '@/server/accounts/reset';
import { passwordResetRepository, userRepository } from '@/server/accounts/repository';
import { maskEmail } from '@/server/accounts/mask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step two: check a reset token, and set a new password with it.
 *
 * `GET  ?token=…` validates without consuming, so the page can show "this link has
 * expired" before the user types a new password rather than after.
 * `POST { token, password }` sets the password and burns the token.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!token) return NextResponse.json({ valid: false }, { headers: NO_STORE });

  const verdict = await verifyReset(passwordResetRepository, token);
  if (!verdict.ok) {
    return NextResponse.json(
      // The reason is safe to return *here* in a way it is not on the request endpoint:
      // holding the token is already evidence, and "expired" versus "already used" is the
      // difference between requesting a new link and realising you already reset it.
      { valid: false, reason: verdict.reason },
      { headers: NO_STORE }
    );
  }

  const user = await userRepository.findById(verdict.reset.userId);
  return NextResponse.json(
    { valid: true, email_masked: maskEmail(user?.email ?? null) },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';
  const limit = await consumeToken(`reset-submit:${ip}`, 10, 1 / 30);
  if (!limit.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.');
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return fail(400, 'invalid_token', 'This reset link is not valid.');

  const password = typeof body.password === 'string' ? body.password : '';
  const problem = passwordProblem(password);
  if (problem) return fail(400, 'weak_password', problem);

  const verdict = await verifyReset(passwordResetRepository, token);
  if (!verdict.ok) {
    return fail(
      400,
      'invalid_token',
      verdict.reason === 'expired'
        ? 'This reset link has expired. Request a new one.'
        : verdict.reason === 'already_used'
          ? 'This reset link has already been used. Request a new one.'
          : 'This reset link is not valid. Request a new one.'
    );
  }

  const user = await userRepository.findById(verdict.reset.userId);
  if (!user || !user.isActive) {
    // The account was deactivated between the request and the reset. Resetting would hand
    // a password to somebody an owner has already removed.
    return fail(403, 'account_disabled', 'This account is no longer active.');
  }

  await userRepository.update(user.id, { passwordHash: await hashPassword(password) });

  // Burn this token, then every other outstanding one for the user. The second call is
  // what stops an attacker who requested their own link earlier from still holding a live
  // one after the real owner has recovered the account.
  await passwordResetRepository.markUsed(verdict.reset.id, Date.now());
  await passwordResetRepository.invalidateFor(user.id);

  console.info(`[reset] password changed for ${maskEmail(user.email)} from ${ip}`);

  // Deliberately no session is issued. Resetting proves control of an inbox, not of the
  // account — and auto-signing-in from a link means anyone who reaches that inbox, or that
  // URL in a proxy log, is inside the console with no second step.
  return NextResponse.json(
    { reset: true, email: user.email },
    { status: 200, headers: NO_STORE }
  );
}

const NO_STORE = { 'cache-control': 'no-store' };

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}
