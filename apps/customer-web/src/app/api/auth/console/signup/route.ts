import { NextResponse, type NextRequest } from 'next/server';
import { storeRepository } from '@/server/stores';
import { validateStoreDraft } from '@/server/stores/validation';
import type { StoreDraft } from '@/server/stores/types';
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

  let body: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
    phone?: unknown;
    /** Present when an owner is registering their shop as part of signing up. */
    store?: unknown;
  };
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

  // ---- the shop, when one is being registered ----
  //
  // Validated before the account is created, so a rejected shop does not leave a usable
  // login behind with nothing attached to it. The two are meant to arrive together.
  let storeDraft: StoreDraft | null = null;
  if (body.store !== undefined && body.store !== null) {
    if (typeof body.store !== 'object') {
      return fail(400, 'invalid_store', 'Expected the shop details as an object.');
    }

    // The owner supplies what an owner can know: the shop's name, where it is, what its
    // Wi-Fi is called and when it opens. The operational fields are defaulted here rather
    // than demanded, because nobody registering a shop from their phone can read their own
    // public IP range off the router, and asking for it is how a signup gets abandoned.
    //
    // Every default is the fail-closed one. An empty CIDR list refuses every shopper and a
    // missing VPA leaves checkout at the counter — which is correct for a shop that is not
    // live yet anyway, and is surfaced in the console as a warning rather than hidden.
    const submitted = {
      authorizedEgressCidrs: [],
      merchantVpa: null,
      merchantDisplayName: null,
      apiBaseUrl: null,
      apiKeyRef: null,
      ...(body.store as Record<string, unknown>),
    };

    // Not `partial`: a shop being registered must end up with every field a shop needs, and
    // the same validator the console's own writes use runs here so the two cannot diverge.
    const parsed = validateStoreDraft(submitted, { partial: false });
    if (!parsed.ok) {
      return fail(400, 'invalid_store', parsed.errors.join(' '));
    }

    storeDraft = {
      ...(parsed.value as StoreDraft),
      // Registered dark, always. The person filling this in is asserting their own shop's
      // name and location and nobody has checked either yet, so it must not be able to
      // appear to customers on their say-so. An existing owner activates it from the
      // console once the details are confirmed.
      isActive: false,
      isOpen: true,
    };
  }

  // An owner creating a colleague's account gets to skip the approval step, since they are
  // the approval step.
  const actor = await readAccount(request);
  const byOwner = actor.ok && atLeast(actor.user.role, 'owner');

  // Created before the account so the account can carry its id. If the account creation
  // then fails, an inactive store with nobody attached is left behind — invisible to
  // customers, listed in the console, and removable there. The opposite ordering would
  // leave a live login belonging to a shop that does not exist, which is worse.
  const store = storeDraft ? await storeRepository.create(storeDraft) : null;

  const user = await userRepository.create({
    // Registering a shop makes you its owner. Not the platform's — `storeId` scopes it, and
    // every branch-aware check already reads that field rather than the role alone.
    role: isBootstrap || store ? 'owner' : 'staff',
    phone,
    email,
    passwordHash: await hashPassword(password),
    name,
    storeId: store?.id ?? null,
    isActive: isBootstrap || byOwner,
  });

  const response = NextResponse.json(
    {
      user: toPublicUser(user),
      bootstrap: isBootstrap,
      // The client needs this to decide between "you're in" and "wait to be approved".
      pending_approval: !user.isActive,
      store: store
        ? {
            id: store.id,
            name: store.name,
            // Never true here, and sent anyway: the signup screen has to tell the owner
            // their shop is registered but not yet visible, and reading that from the
            // record is better than the screen assuming it.
            is_active: store.isActive,
            awaiting_approval: !store.isActive,
          }
        : null,
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
