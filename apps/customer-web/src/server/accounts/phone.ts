import 'server-only';

/**
 * Phone numbers, normalised to one canonical form before they are ever compared.
 *
 * This exists because a phone number is the customer's *identity* here — it is the unique
 * key an account is found by. `+91 98765 43210`, `09876543210` and `919876543210` are the
 * same person, and storing them as typed would let one person accumulate three accounts
 * and one basket end up on whichever spelling they used last.
 *
 * Canonical form is E.164 digits with no `+`: `919876543210`.
 */

const DEFAULT_COUNTRY_CODE = '91';

/** India: 10 digits beginning 6-9. Kept explicit rather than pulling in libphonenumber. */
const INDIAN_SUBSCRIBER = /^[6-9]\d{9}$/;

export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;

  // `0` prefix is the Indian domestic trunk code and is not part of the number.
  const trunkStripped = digits.startsWith('0') ? digits.slice(1) : digits;

  if (INDIAN_SUBSCRIBER.test(trunkStripped)) {
    return `${DEFAULT_COUNTRY_CODE}${trunkStripped}`;
  }

  if (trunkStripped.startsWith(DEFAULT_COUNTRY_CODE)) {
    const subscriber = trunkStripped.slice(DEFAULT_COUNTRY_CODE.length);
    if (INDIAN_SUBSCRIBER.test(subscriber)) return `${DEFAULT_COUNTRY_CODE}${subscriber}`;
  }

  // Anything else is accepted only if it is plausibly E.164, so the pilot is not blocked
  // by a number this narrow validator has not been taught. Rejecting outright would mean
  // a staff member with a foreign mobile could never be given an account.
  if (trunkStripped.length >= 8 && trunkStripped.length <= 15) return trunkStripped;

  return null;
}

/** `919876543210` -> `+91 98765 43210`, for display only. Never used as a key. */
export function formatPhone(canonical: string): string {
  if (canonical.startsWith(DEFAULT_COUNTRY_CODE) && canonical.length === 12) {
    const subscriber = canonical.slice(2);
    return `+91 ${subscriber.slice(0, 5)} ${subscriber.slice(5)}`;
  }
  return `+${canonical}`;
}

/**
 * `919876543210` -> `+91 ****** 3210`.
 *
 * Used wherever a number is echoed back to a caller who has not yet proved they hold it —
 * the "we sent a code to…" screen in particular. Enough digits survive for the customer to
 * confirm they typed their own number; not enough for the endpoint to become a way of
 * confirming which numbers have accounts.
 *
 * Masking is applied to the **subscriber digits only**. The country code is not a secret
 * and hiding it just makes the string harder to read.
 */
export function maskPhone(canonical: string): string {
  const visible = 4;

  if (canonical.startsWith(DEFAULT_COUNTRY_CODE) && canonical.length === 12) {
    const subscriber = canonical.slice(2);
    const hidden = '*'.repeat(subscriber.length - visible);
    return `+91 ${hidden} ${subscriber.slice(-visible)}`;
  }

  if (canonical.length <= visible) return `+${canonical}`;
  return `+${'*'.repeat(canonical.length - visible)}${canonical.slice(-visible)}`;
}
