import 'server-only';
import { randomInt } from 'crypto';

/**
 * The short handle a customer shows at the exit.
 *
 * ## Why an alphabet rather than the order id
 *
 * The order id is 24 hex characters. Nobody reads that off a phone screen and types it on
 * a till without getting it wrong, and asking staff to try is how a verification step
 * becomes a step staff skip.
 *
 * ## Why these characters
 *
 * `O`/`0` and `I`/`1` are removed. This code gets read aloud across a counter and typed by
 * someone who is not looking at the screen, so the failure mode is not a corrupted
 * transmission — it is a human confidently reading a zero as a letter. Removing the
 * ambiguity costs about half a bit per character and eliminates the class entirely.
 *
 * `U` and `V` are kept: they are distinguishable in the uppercase sans-serif the till and
 * the app both use.
 *
 * ## Why six characters is enough
 *
 * 32^6 is about a billion, but that is not the number that matters — the code is only ever
 * looked up **within one store**, and only while an order is unverified. A store with a
 * hundred live unverified orders has a collision probability around 1 in 10 million per
 * new code, and the unique index means a collision is a retry rather than a mix-up.
 *
 * Guessing is not a threat here either: knowing a code lets you *ask staff to verify an
 * order you did not place*, and staff are looking at their own UPI app while they do it.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 6;

export function generateVerificationCode(): string {
  let code = '';
  // randomInt, not Math.random: these are short-lived but they are still identifiers a
  // customer is asked to treat as theirs, and a predictable sequence would let one shopper
  // guess the next.
  for (let index = 0; index < LENGTH; index += 1) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}

/**
 * Normalises what staff typed.
 *
 * Case folding and stripping the spaces and dashes people insert when reading a code
 * aloud. Deliberately nothing else.
 *
 * It is tempting to also "correct" a typed `0` to `O`, but the alphabet contains neither —
 * so a `0` means the reader misidentified some *other* character, and which one is a
 * guess. `Q` and `D` are both plausible. Silently picking one would resolve to a
 * confidently wrong order, which at a payment gate is worse than telling staff the code
 * did not match and letting them look again.
 */
export function normaliseVerificationCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isWellFormedCode(code: string): boolean {
  return code.length === LENGTH && [...code].every((char) => ALPHABET.includes(char));
}
