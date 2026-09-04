import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { hashPassword, passwordProblem } from '@/server/accounts/password';
import { fold, usernameProblem } from '@/server/accounts/username';
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
 * Customer registration — username, password, re-enter password.
 *
 * ## Why this replaces the OTP flow for the pilot
 *
 * The pilot specification excludes OTP deliberately, and the practical reason is delivery:
 * sending an SMS in India needs a registered DLT template and an MSG91 account, neither of
 * which exists yet. A sign-in that cannot deliver its own credential is not a sign-in. A
 * username and a password work on day one with nothing to procure.
 *
 * The OTP endpoints are left in place and unrouted from the customer app — the console
 * still uses them for staff, and deleting a working mechanism to satisfy a temporary
 * product decision would mean rebuilding it when the pilot ends.
 *
 * ## What is not collected
 *
 * No phone number and no email, because the specification asks for three fields and
 * collecting identifiers a pilot has no use for is how a data-protection problem starts.
 * Email is optional and exists only so `forgot-password` has somewhere to send anything at
 * all; an account without one is told to ask the shop rather than being silently unable to
 * recover.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';

  // Registration is cheap for us and cheap to abuse — an unthrottled endpoint that writes a
  // row is a way to fill a table. Slower than sign-in on purpose.
  const limit = await consumeToken(`register:${ip}`, 5, 1 / 60);
  if (!limit.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let body: {
    username?: unknown;
    password?: unknown;
    confirmPassword?: unknown;
    email?: unknown;
    name?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const usernameIssue = usernameProblem(username);
  if (usernameIssue) return fail(400, 'invalid_username', usernameIssue);

  const password = typeof body.password === 'string' ? body.password : '';
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) return fail(400, 'weak_password', passwordIssue);

  // Checked server-side as well as in the form. A mismatch that only the browser enforces
  // is a mismatch that a direct POST can skip, and the result is an account whose owner
  // cannot sign in because they typed their intended password only once.
  const confirm = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  if (confirm !== password) {
    return fail(400, 'password_mismatch', 'Both passwords must match.');
  }

  let email: string | null = null;
  if (typeof body.email === 'string' && body.email.trim()) {
    const candidate = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) || candidate.length > 200) {
      return fail(400, 'invalid_email', 'That does not look like a valid email address.');
    }
    email = candidate;
  }

  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;

  if (await userRepository.findByUsername(username)) {
    // Distinguishable, and it has to be: the person is choosing a name and cannot choose a
    // different one without being told this one is taken. The trade is that usernames
    // become enumerable, which is inherent to any system where users pick their own.
    return fail(409, 'username_taken', 'That username is taken. Please choose another.');
  }

  if (email && (await userRepository.findByEmail(email))) {
    return fail(409, 'email_taken', 'An account already exists for that email address.');
  }

  const user = await userRepository.create({
    role: 'customer',
    phone: null,
    username,
    usernameFolded: fold(username),
    email,
    passwordHash: await hashPassword(password),
    name,
    storeId: null,
    // A shopper needs no approval. The gate that matters for a customer is presence inside
    // a shop, which is enforced per request and has nothing to do with the account.
    isActive: true,
  });

  const response = NextResponse.json(
    { user: toPublicUser(user) },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );

  // Signed in immediately. Registration is a deliberate act by someone standing in a shop
  // wanting to shop; making them type the same credentials again adds nothing.
  setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  return response;
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
