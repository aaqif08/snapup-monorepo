import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode, googleConfig, verifyState } from '@/server/accounts/google';
import { userRepository } from '@/server/accounts/repository';
import {
  createAccountToken,
  isSecureRequest,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';

/**
 * Redeem a Google authorization code for a console session.
 *
 * ## Why this is a POST here rather than the redirect target
 *
 * Google redirects the browser to a single registered URI, and the console is a different
 * origin from this app — a cookie set here would land on the wrong host and the console
 * would still be signed out. So the console owns the redirect URI, receives the code, and
 * hands it to this endpoint server-to-server; `authProxy` then relays the `Set-Cookie` onto
 * the console's own origin, exactly as it does for password sign-in.
 *
 * The division of labour is deliberate. The client **secret** and the state-signing key
 * stay in this app and never reach the console; the console only ever holds the client id
 * and the redirect URI, neither of which is a credential.
 */
export async function POST(request: NextRequest) {
  const config = googleConfig();
  if (!config) {
    return fail(404, 'google_not_configured', 'Google sign-in is not enabled on this deployment.');
  }

  let body: { code?: unknown; state?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const state = typeof body.state === 'string' ? body.state : '';
  if (!code || !state) return fail(400, 'malformed_request', 'Expected a code and a state.');

  // Checked before the code is spent. Without it, an attacker can hand a victim's browser
  // their own authorization code and land the victim inside the attacker's account.
  if (!verifyState(state).valid) {
    return fail(400, 'google_state', 'That sign-in attempt expired. Please try again.');
  }

  const identity = await exchangeCode(config, code);
  if (!identity) {
    return fail(401, 'google_failed', 'Google could not confirm that sign-in. Please try again.');
  }

  const user = await userRepository.findByEmail(identity.email);

  // Deliberately does not create an account.
  //
  // Signing up decides a role, an approval state and — for an owner — an entire shop.
  // None of that follows from someone owning a Google account, so Google is a way into an
  // account that already exists and the signup form is where one is made. Otherwise anyone
  // with a Google account could mint themselves a console login.
  if (!user) {
    return fail(
      404,
      'google_no_account',
      'No console account uses that Google address. Sign up first, then use Google to sign in.'
    );
  }

  // The same gate the password path applies, checked rather than assumed: an account
  // awaiting approval, or one switched off, must not be admitted through a side door.
  if (!user.isActive) {
    return fail(403, 'account_pending', 'That account is waiting to be approved by an owner.');
  }

  const response = NextResponse.json(
    { user: toPublicUser(user), via: 'google' },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
  setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  return response;
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
