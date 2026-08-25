import { NextResponse, type NextRequest } from 'next/server';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';
import { hashPassword, passwordProblem } from '@/server/accounts/password';
import { normalisePhone } from '@/server/accounts/phone';
import { userRepository } from '@/server/accounts/repository';
import {
  createAccountToken,
  isSecureRequest,
  readAccount,
  setAccountCookie,
  toPublicUser,
} from '@/server/accounts/session';
import { atLeast } from '@/server/accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Console sign-up.
 *
 * ## The first account becomes the owner; every one after it does not
 *
 * A pilot has to be bootstrappable by whoever installs it, so the first console account
 * ever created is an `owner` and is active immediately. After that, open signup would mean
 * anyone who finds the URL can create themselves an account on a system that manages eight
 * shops — so subsequent signups are created as **inactive `staff`** and an owner activates
 * and promotes them from Staff management.
 *
 * The alternative — shipping a default `owner/owner123` — is the single most common way a
 * pilot goes live with a back door, and it is why the seed deliberately contains no users.
 *
 * An owner who is already signed in can create an active account directly, which is what
 * the Staff management screen uses.
 */
export async function POST(request: NextRequest) {
  const ip = getEgressIp(request) ?? 'unknown';
  const limit = await consumeToken(`console-signup:${ip}`, 5, 1 / 60);
  if (!limit.allowed) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a moment.', {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let body: { email?: unknown; password?: unknown; name?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return fail(400, 'invalid_email', 'Enter a valid work email address.');
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const problem = passwordProblem(password);
  if (problem) return fail(400, 'weak_password', problem);

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;

  // Optional, and the reason an owner can also use the customer app: the customer app
  // signs in by phone, so an account with no phone can never do so.
  let phone: string | null = null;
  if (typeof body.phone === 'string' && body.phone.trim()) {
    phone = normalisePhone(body.phone);
    if (!phone) return fail(400, 'invalid_phone', 'That does not look like a valid mobile number.');
  }

  if (await userRepository.findByEmail(email)) {
    // Distinguishable on purpose. This is a console for a known set of colleagues, not a
    // consumer product — "that email is already registered" is what lets someone realise
    // they should be signing in, and the address is one their employer already knows.
    return fail(409, 'email_taken', 'An account already exists for that email. Try signing in.');
  }

  if (phone && (await userRepository.findByPhone(phone))) {
    return fail(409, 'phone_taken', 'That mobile number is already attached to an account.');
  }

  const existingStaff = await userRepository.countStaff();
  const isBootstrap = existingStaff === 0;

  // An owner creating a colleague's account gets to skip the approval step, since they are
  // the approval step.
  const actor = await readAccount(request);
  const byOwner = actor.ok && atLeast(actor.user.role, 'owner');

  const user = await userRepository.create({
    role: isBootstrap ? 'owner' : 'staff',
    phone,
    email,
    passwordHash: await hashPassword(password),
    name,
    storeId: null,
    isActive: isBootstrap || byOwner,
  });

  const response = NextResponse.json(
    {
      user: toPublicUser(user),
      bootstrap: isBootstrap,
      // The client needs this to decide between "you're in" and "wait to be approved".
      pending_approval: !user.isActive,
    },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );

  // Only the bootstrap owner is signed in by signing up. A pending account has nothing to
  // sign in to, and an owner creating a colleague must not be swapped into that colleague's
  // session halfway through managing staff.
  if (isBootstrap) {
    setAccountCookie(response, createAccountToken(user.id), isSecureRequest(request));
  }

  return response;
}

function fail(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...headers } }
  );
}
