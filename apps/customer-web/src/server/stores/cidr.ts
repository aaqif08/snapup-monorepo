import 'server-only';

/** `a.b.c.d/n`, with every octet in range and a prefix length of 0-32. */
const CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/**
 * Validates the notation only — it does not decide whether a range is *safe* to trust.
 *
 * Moved out of `memoryRepository.ts`, where it had nothing to do with the storage strategy:
 * `validation.ts` uses it to reject a malformed CIDR before a store is ever written, which
 * has to hold whichever repository is in play.
 */
export function isValidCidr(value: string): boolean {
  const match = CIDR_PATTERN.exec(value.trim());
  if (!match) return false;

  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  if (octets.some((octet) => octet > 255)) return false;

  const bits = Number(match[5]);
  return bits >= 0 && bits <= 32;
}
