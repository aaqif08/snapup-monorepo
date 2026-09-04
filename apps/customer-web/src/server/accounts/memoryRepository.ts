import 'server-only';
import { fold } from './username';
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
 * Accounts in process memory.
 *
 * Carries the same limitation as the other in-memory repositories and one extra
 * consequence worth stating: **accounts do not survive a restart**. In Next dev that
 * includes a route recompile, so an account created a minute ago can vanish mid-flow and
 * look like a login bug.
 *
 * That is survivable for a demo and not for a pilot. Set `DATABASE_URL` and the Postgres
 * repository takes over — see `repository.ts`.
 *
 * The seed is deliberately empty. A default owner with a known password is the single most
 * common way a pilot ships with a live back door; the first console signup becomes the
 * owner instead, which is a decision the operator makes rather than one we make for them.
 */
class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>();

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async findByPhone(phone: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.phone === phone) return { ...user };
    }
    return null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const wanted = fold(username);
    for (const user of this.users.values()) {
      if (user.usernameFolded === wanted) return { ...user };
    }
    return null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const wanted = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email?.toLowerCase() === wanted) return { ...user };
    }
    return null;
  }

  async listStaff(): Promise<UserRecord[]> {
    return [...this.users.values()]
      .filter((user) => user.role !== 'customer')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((user) => ({ ...user }));
  }

  async countStaff(): Promise<number> {
    return [...this.users.values()].filter((user) => user.role !== 'customer').length;
  }

  async create(draft: UserDraft): Promise<UserRecord> {
    const record: UserRecord = {
      id: `usr_${randomNonce(9)}`,
      role: draft.role,
      phone: draft.phone,
      username: draft.username ?? null,
      usernameFolded: draft.username ? fold(draft.username) : null,
      email: draft.email,
      passwordHash: draft.passwordHash,
      name: draft.name,
      storeId: draft.storeId,
      isActive: draft.isActive,
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    this.users.set(record.id, record);
    return { ...record };
  }

  async update(id: string, patch: Partial<UserDraft>): Promise<UserRecord | null> {
    const existing = this.users.get(id);
    if (!existing) return null;

    const updated: UserRecord = { ...existing, ...patch, id: existing.id };
    this.users.set(id, updated);
    return { ...updated };
  }

  async recordLogin(id: string, at: number): Promise<void> {
    const existing = this.users.get(id);
    if (existing) this.users.set(id, { ...existing, lastLoginAt: at });
  }
}

class InMemoryOtpRepository implements OtpRepository {
  private readonly challenges = new Map<string, OtpChallenge>();

  async create(challenge: Omit<OtpChallenge, 'id'>): Promise<OtpChallenge> {
    const record: OtpChallenge = { ...challenge, id: `otp_${randomNonce(9)}` };
    this.challenges.set(record.id, record);

    // Opportunistic sweep. Without it a long-lived process accumulates one dead row per
    // login attempt forever, which is a slow leak rather than a bug but is still a leak.
    this.sweep();
    return { ...record };
  }

  async findActive(phone: string, now: number): Promise<OtpChallenge | null> {
    let newest: OtpChallenge | null = null;
    for (const challenge of this.challenges.values()) {
      if (challenge.phone !== phone) continue;
      if (challenge.consumedAt !== null) continue;
      if (challenge.expiresAt <= now) continue;
      if (!newest || challenge.createdAt > newest.createdAt) newest = challenge;
    }
    return newest ? { ...newest } : null;
  }

  async recordAttempt(id: string): Promise<void> {
    const existing = this.challenges.get(id);
    if (existing) this.challenges.set(id, { ...existing, attempts: existing.attempts + 1 });
  }

  async consume(id: string, at: number): Promise<void> {
    const existing = this.challenges.get(id);
    if (existing) this.challenges.set(id, { ...existing, consumedAt: at });
  }

  async invalidateFor(phone: string): Promise<void> {
    for (const [id, challenge] of this.challenges) {
      if (challenge.phone === phone && challenge.consumedAt === null) {
        this.challenges.set(id, { ...challenge, consumedAt: Date.now() });
      }
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt < cutoff) this.challenges.delete(id);
    }
  }
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  private readonly resets = new Map<string, PasswordReset>();

  async create(reset: Omit<PasswordReset, 'id'>): Promise<PasswordReset> {
    const record: PasswordReset = { ...reset, id: `rst_${randomNonce(9)}` };
    this.resets.set(record.id, record);
    return { ...record };
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    for (const reset of this.resets.values()) {
      if (reset.tokenHash === tokenHash) return { ...reset };
    }
    return null;
  }

  async markUsed(id: string, at: number): Promise<void> {
    const existing = this.resets.get(id);
    if (existing) this.resets.set(id, { ...existing, usedAt: at });
  }

  async invalidateFor(userId: string): Promise<void> {
    const now = Date.now();
    for (const [id, reset] of this.resets) {
      if (reset.userId === userId && reset.usedAt === null) {
        this.resets.set(id, { ...reset, usedAt: now });
      }
    }
  }
}

export const memoryUserRepository: UserRepository = new InMemoryUserRepository();
export const memoryOtpRepository: OtpRepository = new InMemoryOtpRepository();
export const memoryPasswordResetRepository: PasswordResetRepository =
  new InMemoryPasswordResetRepository();
