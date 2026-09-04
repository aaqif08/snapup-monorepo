import 'server-only';

/**
 * Customer usernames.
 *
 * The pilot specification excludes OTP and asks for basic username/password sign-in, so a
 * shopper's identity is no longer their phone number. This is the whole of what a username
 * may be, kept in one place because two different opinions about what counts as valid —
 * one at registration and one at sign-in — is how an account becomes unreachable by the
 * person who created it.
 *
 * ## Folding
 *
 * Uniqueness and lookup use the folded form; display uses what was typed. Someone who
 * registers as `Dharsan` sees `Dharsan` on their account and can sign in as `dharsan`, and
 * nobody else can register either spelling. Storing only the lower-cased version would
 * quietly rename people, and comparing raw values would let two accounts differ by a
 * capital letter — an impersonation route that costs nothing to close.
 *
 * Folding is `toLowerCase()` on purpose rather than a full Unicode case fold: the character
 * set below is ASCII, so there is no Turkish dotless-i class of problem to solve, and
 * pretending to handle more than the input allows would be misleading.
 */

const PATTERN = /^[a-zA-Z0-9._-]{3,30}$/;

/**
 * Reserved because they read as the system speaking rather than a person.
 *
 * A shopper called `admin` in a staff-facing list is a support call at best and a
 * successful social-engineering attempt at worst.
 */
const RESERVED = new Set([
  'admin',
  'administrator',
  'snapup',
  'snap-up',
  'support',
  'help',
  'staff',
  'owner',
  'manager',
  'root',
  'system',
  'security',
  'billing',
  'payments',
]);

export function fold(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Returns the problem with a username, or null when it is acceptable.
 *
 * Phrased as the fix rather than the rule — "must be 3 to 30 characters" is something a
 * person can act on where "invalid username" is not.
 */
export function usernameProblem(username: string): string | null {
  const trimmed = username.trim();

  if (!trimmed) return 'Choose a username.';
  if (trimmed.length < 3) return 'Usernames must be at least 3 characters.';
  if (trimmed.length > 30) return 'Usernames must be 30 characters or fewer.';

  if (!PATTERN.test(trimmed)) {
    return 'Usernames can use letters, numbers, dots, underscores and hyphens only.';
  }

  // A username that is entirely punctuation passes the pattern above and is unusable as a
  // name. Requiring one alphanumeric character is cheaper than enumerating the shapes.
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    return 'Usernames need at least one letter or number.';
  }

  if (RESERVED.has(fold(trimmed))) {
    return 'That username is reserved. Please choose another.';
  }

  return null;
}
