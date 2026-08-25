import 'server-only';

/**
 * Accounts are SnapUp's own data, not the retailer's.
 *
 * Deliberately unlike products and orders, which live in the retailer's system and are
 * fetched per request. Who may sign in to SnapUp is SnapUp's question — putting it behind
 * the retailer's API would mean an outage at one branch locked staff out of the console
 * for all eight, and would ask a supermarket to hold password hashes it has no use for.
 *
 * So there are two backends here, not three: memory and Postgres.
 */

/**
 * Owner > manager > staff, most privileged first.
 *
 * Ordered so a permission check is a comparison rather than a lookup table that has to be
 * kept in sync with the roles it describes.
 */
export const ROLES = ['owner', 'manager', 'staff', 'customer'] as const;
export type Role = (typeof ROLES)[number];

/** Rank for privilege comparisons. Lower is more privileged. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 0,
  manager: 1,
  staff: 2,
  customer: 3,
};

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[minimum];
}

/** The roles that may sign in to the business console at all. */
export const STAFF_ROLES: Role[] = ['owner', 'manager', 'staff'];

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export interface UserRecord {
  id: string;
  role: Role;

  /**
   * E.164 without the `+`, e.g. `919876543210`. Unique when present.
   *
   * The customer app signs in by phone and OTP, so this is a customer's only identifier.
   * A staff member may also have one — that is how an owner signs in to the customer app
   * as well as the console, which is the "both apps, same person" case.
   */
  phone: string | null;

  /** Console identity. Unique when present. Customers normally have none. */
  email: string | null;

  /**
   * scrypt, stored as `scrypt$N$r$p$salt$hash`. Null for accounts that only ever sign in
   * by OTP, which is every customer — there is no password to steal from a phone-only
   * account, and no password reset flow to abuse.
   */
  passwordHash: string | null;

  name: string | null;

  /**
   * Branch this staff member belongs to, or null for chain-wide access.
   *
   * Not enforced as a permission boundary yet — it is recorded so that when per-branch
   * scoping is switched on, the data to enforce it already exists rather than having to be
   * backfilled from memory.
   */
  storeId: string | null;

  /**
   * Deactivated accounts cannot sign in but are never deleted.
   *
   * Orders, analytics events and audit trails reference a user id; deleting the row would
   * orphan them and make "who approved this refund" unanswerable. `removeUser` therefore
   * deactivates, and the console calls it "remove".
   */
  isActive: boolean;

  createdAt: number;
  lastLoginAt: number | null;
}

/** What the console and the customer app are allowed to see about a user. */
export interface PublicUser {
  id: string;
  role: Role;
  phone: string | null;
  email: string | null;
  name: string | null;
  storeId: string | null;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface UserDraft {
  role: Role;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  name: string | null;
  storeId: string | null;
  isActive: boolean;
}

/**
 * A pending one-time code.
 *
 * The code itself is **hashed**, for the same reason a password is: this table is read by
 * anyone with database access, and a plaintext code is a live credential for whoever is
 * looking. Hashing it means a leaked dump cannot be used to sign in as a customer.
 */
export interface OtpChallenge {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: number;
  /** Wrong guesses so far. The challenge is burnt after too many. */
  attempts: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByPhone(phone: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Every account with a console role. Customers are excluded. */
  listStaff(): Promise<UserRecord[]>;
  countStaff(): Promise<number>;
  create(draft: UserDraft): Promise<UserRecord>;
  update(id: string, patch: Partial<UserDraft>): Promise<UserRecord | null>;
  recordLogin(id: string, at: number): Promise<void>;
}

/**
 * A pending password reset.
 *
 * Console accounts only. Customers sign in with a phone and a one-time code, so they have
 * no password to forget — which removes the most commonly abused account-recovery flow
 * for the larger population rather than merely securing it.
 *
 * `tokenHash` is a SHA-256 of a long random token. Unlike the OTP there is no pepper and
 * no need for one: the token has 256 bits of entropy, so there is no candidate space to
 * search even with the hash in hand.
 */
export interface PasswordReset {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
  /** For the audit trail. Never used to decide whether a reset is allowed. */
  requestedIp: string | null;
}

export interface PasswordResetRepository {
  create(reset: Omit<PasswordReset, 'id'>): Promise<PasswordReset>;
  /** The reset for this token, if it exists at all. Expiry and reuse are checked by callers. */
  findByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  markUsed(id: string, at: number): Promise<void>;
  /** Invalidates every outstanding reset for a user, e.g. after one succeeds. */
  invalidateFor(userId: string): Promise<void>;
}

export interface OtpRepository {
  create(challenge: Omit<OtpChallenge, 'id'>): Promise<OtpChallenge>;
  /** The newest unconsumed, unexpired challenge for a phone, if any. */
  findActive(phone: string, now: number): Promise<OtpChallenge | null>;
  recordAttempt(id: string): Promise<void>;
  consume(id: string, at: number): Promise<void>;
  /** Invalidates every outstanding challenge for a phone. */
  invalidateFor(phone: string): Promise<void>;
}
