import 'server-only';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Password hashing, on Node's own scrypt.
 *
 * No dependency on purpose. bcrypt and argon2 both ship native bindings, which is a
 * build-time liability on a project that deploys to serverless — and scrypt is in the
 * standard library, is memory-hard, and is what NIST SP 800-63B recommends when PBKDF2 is
 * not required for compliance.
 *
 * The parameters below are the interactive-login end of the scrypt paper's suggestions:
 * N=2^15 costs roughly 100 ms and 32 MB per hash on a modern server. That is slow enough
 * to make offline cracking expensive and fast enough that a login does not feel broken.
 * They are encoded into every hash, so raising them later does not invalidate existing
 * passwords — `verifyPassword` reads whatever each stored hash was made with.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

// scrypt's default maxmem (32 MB) is *exactly* at the boundary for N=2^15, r=8 and throws
// intermittently. Asking for headroom rather than tuning N down keeps the cost factor.
const MAXMEM = 64 * 1024 * 1024;

const PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [PREFIX, N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing for every malformed input. A corrupt hash column
 * should read as "wrong password" and be caught by the login rate limiter, not as a 500
 * that tells an attacker their guess reached something unusual.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64url');
    actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, params);
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Minimum password policy for console accounts.
 *
 * Length only, deliberately. Composition rules ("one uppercase, one symbol") measurably
 * push people towards `Password1!` and are advised against by NIST SP 800-63B; length is
 * the property that actually costs an attacker anything.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) {
    // scrypt happily hashes megabytes, which makes a long password a cheap way to burn
    // server CPU. The cap is far above any real password.
    return 'Password must be at most 200 characters.';
  }
  return null;
}

/**
 * A hash of nothing anyone knows, used to spend the same time on a missing account.
 *
 * Computed once, lazily, so the cost lands on the first failed sign-in rather than on every
 * cold start of every route bundle that imports this module.
 */
let decoyHash: Promise<string> | null = null;

/**
 * Verify a password, doing the same work whether or not the account exists.
 *
 * `verifyPassword` returns immediately when there is no stored hash, which is correct for
 * its own purposes and wrong for sign-in: scrypt takes around a tenth of a second, so
 * "unknown username" answers in a millisecond while "known username, wrong password" takes
 * a hundred. That difference is a username oracle that no amount of careful wording in the
 * error message can close.
 *
 * Hashing the supplied password against a decoy costs the same tenth of a second and makes
 * the two indistinguishable.
 */
export async function verifyPasswordConstantTime(
  password: string,
  stored: string | null
): Promise<boolean> {
  if (stored) return verifyPassword(password, stored);

  decoyHash ??= hashPassword('decoy-password-for-timing-equalisation');
  await verifyPassword(password, await decoyHash);
  return false;
}
