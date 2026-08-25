import { NextResponse, type NextRequest } from 'next/server';
import { hashPassword, passwordProblem } from '@/server/accounts/password';
import { normalisePhone } from '@/server/accounts/phone';
import { userRepository } from '@/server/accounts/repository';
import { requireRole, toPublicUser } from '@/server/accounts/session';
import { ROLES, type Role } from '@/server/accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff management.
 *
 * Guarded by the **account session**, not by the shared `SNAPUP_ADMIN_API_TOKEN`. That
 * token is a single shared credential held by the admin app's server — fine for machine
 * calls into the store registry, useless here, because "which human is doing this" is the
 * entire question a staff screen has to answer. Every action below is attributable to a
 * signed-in user, and the role that user holds decides what they may do.
 */

/** Listing is manager-and-above: a staff member has no reason to enumerate colleagues. */
export async function GET(request: NextRequest) {
  const actor = await requireRole(request, 'manager');
  if (!actor) return forbidden();

  const staff = await userRepository.listStaff();

  return NextResponse.json(
    {
      staff: staff.map(toPublicUser),
      // Drives what the console offers. Sending the rules rather than reimplementing them
      // in the client keeps one source of truth for who may do what.
      can_manage: actor.role === 'owner',
      actor_id: actor.id,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

/**
 * Add a staff member.
 *
 * Owner only. A manager who could mint accounts could mint an owner account, which makes
 * the distinction between the two roles decorative.
 */
export async function POST(request: NextRequest) {
  const actor = await requireRole(request, 'owner');
  if (!actor) return forbidden();

  let body: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
    phone?: unknown;
    role?: unknown;
    storeId?: unknown;
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

  const role = typeof body.role === 'string' ? (body.role as Role) : 'staff';
  if (!ROLES.includes(role) || role === 'customer') {
    return fail(400, 'invalid_role', 'Role must be owner, manager or staff.');
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const problem = passwordProblem(password);
  if (problem) return fail(400, 'weak_password', problem);

  let phone: string | null = null;
  if (typeof body.phone === 'string' && body.phone.trim()) {
    phone = normalisePhone(body.phone);
    if (!phone) return fail(400, 'invalid_phone', 'That does not look like a valid mobile number.');
  }

  if (await userRepository.findByEmail(email)) {
    return fail(409, 'email_taken', 'An account already exists for that email.');
  }
  if (phone && (await userRepository.findByPhone(phone))) {
    return fail(409, 'phone_taken', 'That mobile number is already attached to an account.');
  }

  const created = await userRepository.create({
    role,
    phone,
    email,
    passwordHash: await hashPassword(password),
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null,
    storeId: typeof body.storeId === 'string' && body.storeId ? body.storeId : null,
    isActive: true,
  });

  console.info(`[staff] ${actor.email} created ${created.email} as ${created.role}`);

  return NextResponse.json(
    {
      staff: toPublicUser(created),
      // The owner has to pass this on out of band. It is shown once and never stored in
      // recoverable form, so there is no "resend password" — only a reset.
      notice: 'Give this person their password directly. It cannot be shown again.',
    },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );
}

function forbidden() {
  return fail(403, 'forbidden', 'You do not have permission to manage staff.');
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
