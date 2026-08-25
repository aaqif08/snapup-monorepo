import { NextResponse, type NextRequest } from 'next/server';
import { hashPassword, passwordProblem } from '@/server/accounts/password';
import { normalisePhone } from '@/server/accounts/phone';
import { userRepository } from '@/server/accounts/repository';
import { requireRole, toPublicUser } from '@/server/accounts/session';
import { ROLES, type Role, type UserDraft } from '@/server/accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Edit one staff member: role, details, activation, password reset.
 *
 * Owner only, and with two guards that exist because of what they prevent rather than
 * because a spec asked for them:
 *
 *   1. **An owner cannot demote or deactivate themselves.** Doing so is a one-way door —
 *      the moment it saves, the session that could undo it no longer has permission. On a
 *      single-owner install that locks everybody out of staff management permanently, with
 *      no recovery short of editing the database by hand.
 *
 *   2. **The last active owner cannot be removed.** Same failure, reached from the other
 *      direction: demote the only other owner, then this one, and the console has no owner
 *      at all. `countActiveOwners` is checked against the state *after* the change.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const actor = await requireRole(request, 'owner');
  if (!actor) return forbidden();

  const { id } = await params;
  const target = await userRepository.findById(id);
  if (!target || target.role === 'customer') {
    return fail(404, 'not_found', 'No such staff member.');
  }

  let body: {
    role?: unknown;
    name?: unknown;
    phone?: unknown;
    storeId?: unknown;
    isActive?: unknown;
    password?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const patch: Partial<UserDraft> = {};

  if (body.role !== undefined) {
    const role = body.role as Role;
    if (!ROLES.includes(role) || role === 'customer') {
      return fail(400, 'invalid_role', 'Role must be owner, manager or staff.');
    }
    if (target.id === actor.id && role !== 'owner') {
      return fail(
        400,
        'self_demotion',
        'You cannot change your own role. Ask another owner to do it, so nobody is locked out.'
      );
    }
    patch.role = role;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return fail(400, 'invalid_state', 'isActive must be true or false.');
    }
    if (target.id === actor.id && !body.isActive) {
      return fail(400, 'self_deactivation', 'You cannot deactivate your own account.');
    }
    patch.isActive = body.isActive;
  }

  // Evaluated against the resulting state, not the current one, so demoting and
  // deactivating are both caught by the same check.
  const wouldRemainOwner =
    (patch.role ?? target.role) === 'owner' && (patch.isActive ?? target.isActive);
  if (target.role === 'owner' && target.isActive && !wouldRemainOwner) {
    const owners = await countActiveOwners();
    if (owners <= 1) {
      return fail(
        400,
        'last_owner',
        'This is the only active owner. Promote someone else to owner first.'
      );
    }
  }

  if (body.name !== undefined) {
    patch.name =
      typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;
  }

  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === '') {
      patch.phone = null;
    } else if (typeof body.phone === 'string') {
      const phone = normalisePhone(body.phone);
      if (!phone) return fail(400, 'invalid_phone', 'That does not look like a valid mobile number.');
      const holder = await userRepository.findByPhone(phone);
      if (holder && holder.id !== target.id) {
        return fail(409, 'phone_taken', 'That mobile number is already attached to an account.');
      }
      patch.phone = phone;
    }
  }

  if (body.storeId !== undefined) {
    patch.storeId = typeof body.storeId === 'string' && body.storeId ? body.storeId : null;
  }

  if (body.password !== undefined) {
    const password = typeof body.password === 'string' ? body.password : '';
    const problem = passwordProblem(password);
    if (problem) return fail(400, 'weak_password', problem);
    patch.passwordHash = await hashPassword(password);
  }

  const updated = await userRepository.update(target.id, patch);
  if (!updated) return fail(404, 'not_found', 'No such staff member.');

  console.info(`[staff] ${actor.email} updated ${updated.email}: ${Object.keys(patch).join(', ')}`);

  return NextResponse.json(
    { staff: toPublicUser(updated) },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

/**
 * Remove a staff member — which deactivates rather than deletes.
 *
 * Analytics events and order records reference a user id. Deleting the row would orphan
 * them and make "who approved this" unanswerable, so the account is switched off instead.
 * The console calls it Remove because that is what it means operationally: they can no
 * longer sign in, immediately, everywhere — `readAccount` re-reads `isActive` on every
 * request, which is what makes this work against a session that never expires.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const actor = await requireRole(request, 'owner');
  if (!actor) return forbidden();

  const { id } = await params;
  const target = await userRepository.findById(id);
  if (!target || target.role === 'customer') {
    return fail(404, 'not_found', 'No such staff member.');
  }

  if (target.id === actor.id) {
    return fail(400, 'self_removal', 'You cannot remove your own account.');
  }

  if (target.role === 'owner' && target.isActive && (await countActiveOwners()) <= 1) {
    return fail(400, 'last_owner', 'This is the only active owner. Promote someone else first.');
  }

  const updated = await userRepository.update(target.id, { isActive: false });
  if (!updated) return fail(404, 'not_found', 'No such staff member.');

  console.info(`[staff] ${actor.email} removed ${updated.email}`);

  return NextResponse.json(
    {
      staff: toPublicUser(updated),
      notice: 'Access revoked immediately. The account is kept so past activity stays attributable.',
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

async function countActiveOwners(): Promise<number> {
  const staff = await userRepository.listStaff();
  return staff.filter((user) => user.role === 'owner' && user.isActive).length;
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
