import 'server-only';
import { fold } from './username';
import { db } from '../db/client';
import { randomNonce } from '../crypto';
import type {
  OtpChallenge,
  OtpRepository,
  PasswordReset,
  PasswordResetRepository,
  UserDraft,
  UserRecord,
  UserRepository,
} from './types';

/**
 * Accounts, durable.
 *
 * This is the repository the pilot needs. The in-memory one loses every account on a
 * restart, which for products is an inconvenience and for accounts means the owner is
 * locked out of their own console and has to re-run the bootstrap signup.
 */

type Row = Record<string, unknown>;

function toUser(row: Row): UserRecord {
  return {
    id: row.id as string,
    role: row.role as UserRecord['role'],
    phone: (row.phone as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    usernameFolded: (row.username_folded as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    passwordHash: (row.password_hash as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    storeId: (row.store_id as string | null) ?? null,
    isActive: row.is_active as boolean,
    createdAt: toMillis(row.created_at),
    lastLoginAt: row.last_login_at === null ? null : toMillis(row.last_login_at),
  };
}

function toReset(row: Row): PasswordReset {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    expiresAt: toMillis(row.expires_at),
    usedAt: row.used_at === null ? null : toMillis(row.used_at),
    createdAt: toMillis(row.created_at),
    requestedIp: (row.requested_ip as string | null) ?? null,
  };
}

function toChallenge(row: Row): OtpChallenge {
  return {
    id: row.id as string,
    phone: row.phone as string,
    codeHash: row.code_hash as string,
    expiresAt: toMillis(row.expires_at),
    attempts: Number(row.attempts),
    consumedAt: row.consumed_at === null ? null : toMillis(row.consumed_at),
    createdAt: toMillis(row.created_at),
  };
}

/**
 * `timestamptz` to epoch millis.
 *
 * The driver may hand back a `Date` or an ISO string depending on version and pooling
 * mode, and a silent `NaN` here would make every OTP look expired.
 */
function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<UserRecord | null> {
    const sql = db();
    const rows = (await sql`SELECT * FROM users WHERE id = ${id}`) as Row[];
    return rows.length > 0 ? toUser(rows[0]) : null;
  }

  async findByPhone(phone: string): Promise<UserRecord | null> {
    const sql = db();
    const rows = (await sql`SELECT * FROM users WHERE phone = ${phone}`) as Row[];
    return rows.length > 0 ? toUser(rows[0]) : null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const sql = db();
    // Matched on the folded column, which is what the unique index covers. Folding the
    // input here rather than in SQL keeps one definition of what folding means.
    const rows = (await sql`
      SELECT * FROM users WHERE username_folded = ${fold(username)}
    `) as Row[];
    return rows.length > 0 ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const sql = db();
    // Compared lowercased on both sides. Email is case-insensitive in practice, and an
    // owner who signs up as `Owner@` and later types `owner@` must reach the same account.
    const rows = (await sql`
      SELECT * FROM users WHERE lower(email) = lower(${email})
    `) as Row[];
    return rows.length > 0 ? toUser(rows[0]) : null;
  }

  async listStaff(): Promise<UserRecord[]> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM users WHERE role <> 'customer' ORDER BY created_at, id
    `) as Row[];
    return rows.map(toUser);
  }

  async countStaff(): Promise<number> {
    const sql = db();
    const rows = (await sql`SELECT count(*)::int AS n FROM users WHERE role <> 'customer'`) as Row[];
    return Number(rows[0]?.n ?? 0);
  }

  async create(draft: UserDraft): Promise<UserRecord> {
    const sql = db();
    const rows = (await sql`
      INSERT INTO users (
        id, role, phone, username, username_folded, email, password_hash, name,
        store_id, is_active
      )
      VALUES (
        ${`usr_${randomNonce(9)}`},
        ${draft.role},
        ${draft.phone},
        ${draft.username ?? null},
        ${draft.username ? fold(draft.username) : null},
        ${draft.email},
        ${draft.passwordHash},
        ${draft.name},
        ${draft.storeId},
        ${draft.isActive}
      )
      RETURNING *
    `) as Row[];
    return toUser(rows[0]);
  }

  async update(id: string, patch: Partial<UserDraft>): Promise<UserRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    // Read-merge-write, matching the store repository. `Partial` uses absence to mean
    // "leave alone" and null to mean "clear", and several of these columns genuinely take
    // null — a COALESCE update could not tell those apart.
    const merged = { ...existing, ...patch };

    const sql = db();
    const rows = (await sql`
      UPDATE users SET
        role          = ${merged.role},
        phone         = ${merged.phone},
        email         = ${merged.email},
        password_hash = ${merged.passwordHash},
        name          = ${merged.name},
        store_id      = ${merged.storeId},
        is_active     = ${merged.isActive}
      WHERE id = ${id}
      RETURNING *
    `) as Row[];

    return rows.length > 0 ? toUser(rows[0]) : null;
  }

  async recordLogin(id: string, at: number): Promise<void> {
    const sql = db();
    await sql`UPDATE users SET last_login_at = ${new Date(at).toISOString()} WHERE id = ${id}`;
  }
}

class PostgresOtpRepository implements OtpRepository {
  async create(challenge: Omit<OtpChallenge, 'id'>): Promise<OtpChallenge> {
    const sql = db();
    const rows = (await sql`
      INSERT INTO otp_challenges (id, phone, code_hash, expires_at, attempts, consumed_at)
      VALUES (
        ${`otp_${randomNonce(9)}`},
        ${challenge.phone},
        ${challenge.codeHash},
        ${new Date(challenge.expiresAt).toISOString()},
        ${challenge.attempts},
        ${challenge.consumedAt === null ? null : new Date(challenge.consumedAt).toISOString()}
      )
      RETURNING *
    `) as Row[];

    // Housekeeping on write rather than a scheduled job: there is no scheduler in a
    // serverless deployment, and an unbounded challenge table is a slow leak.
    await sql`DELETE FROM otp_challenges WHERE expires_at < now() - interval '1 hour'`;

    return toChallenge(rows[0]);
  }

  async findActive(phone: string, now: number): Promise<OtpChallenge | null> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM otp_challenges
       WHERE phone = ${phone}
         AND consumed_at IS NULL
         AND expires_at > ${new Date(now).toISOString()}
       ORDER BY created_at DESC
       LIMIT 1
    `) as Row[];
    return rows.length > 0 ? toChallenge(rows[0]) : null;
  }

  async recordAttempt(id: string): Promise<void> {
    const sql = db();
    await sql`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ${id}`;
  }

  async consume(id: string, at: number): Promise<void> {
    const sql = db();
    await sql`
      UPDATE otp_challenges SET consumed_at = ${new Date(at).toISOString()} WHERE id = ${id}
    `;
  }

  async invalidateFor(phone: string): Promise<void> {
    const sql = db();
    await sql`
      UPDATE otp_challenges SET consumed_at = now()
       WHERE phone = ${phone} AND consumed_at IS NULL
    `;
  }
}

class PostgresPasswordResetRepository implements PasswordResetRepository {
  async create(reset: Omit<PasswordReset, 'id'>): Promise<PasswordReset> {
    const sql = db();
    const rows = (await sql`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, requested_ip)
      VALUES (
        ${`rst_${randomNonce(9)}`},
        ${reset.userId},
        ${reset.tokenHash},
        ${new Date(reset.expiresAt).toISOString()},
        ${reset.usedAt === null ? null : new Date(reset.usedAt).toISOString()},
        ${reset.requestedIp}
      )
      RETURNING *
    `) as Row[];

    // Housekeeping on write: there is no scheduler in a serverless deployment, and an
    // unbounded table of dead reset rows is a slow leak.
    await sql`DELETE FROM password_resets WHERE expires_at < now() - interval '7 days'`;

    return toReset(rows[0]);
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM password_resets WHERE token_hash = ${tokenHash} LIMIT 1
    `) as Row[];
    return rows.length > 0 ? toReset(rows[0]) : null;
  }

  async markUsed(id: string, at: number): Promise<void> {
    const sql = db();
    await sql`
      UPDATE password_resets SET used_at = ${new Date(at).toISOString()} WHERE id = ${id}
    `;
  }

  async invalidateFor(userId: string): Promise<void> {
    const sql = db();
    await sql`
      UPDATE password_resets SET used_at = now()
       WHERE user_id = ${userId} AND used_at IS NULL
    `;
  }
}

export const postgresUserRepository: UserRepository = new PostgresUserRepository();
export const postgresOtpRepository: OtpRepository = new PostgresOtpRepository();
export const postgresPasswordResetRepository: PasswordResetRepository =
  new PostgresPasswordResetRepository();
