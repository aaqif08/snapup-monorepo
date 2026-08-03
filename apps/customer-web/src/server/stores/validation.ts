import 'server-only';
import { isValidLatitude, isValidLongitude } from './geo';
import { isValidCidr } from './memoryRepository';
import type { StoreDraft } from './types';

const MAX_NAME = 120;
const MAX_ADDRESS = 200;
const MAX_SSID = 64;
const MAX_CIDRS = 16;
const MAX_MERCHANT_NAME = 64;

/**
 * UPI virtual payment address, `identifier@handle`.
 *
 * Format-checked only. There is no way to confirm from here that a VPA is live or that it
 * belongs to this retailer — that requires a name-resolution call to a PSP. Until that
 * exists, a typo'd-but-well-formed VPA sends a customer's money to whoever owns it, so
 * onboarding must verify the address out of band with a small test payment.
 */
const VPA_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Validates an admin-supplied store payload.
 *
 * `partial` mode backs PATCH, where an absent field means "leave it alone" and must not
 * be confused with an empty one. Every field that *is* present is validated identically
 * in both modes, so a value cannot be smuggled past validation by sending it as an update
 * rather than a create.
 */
export function validateStoreDraft(
  input: unknown,
  { partial }: { partial: boolean }
): ValidationResult<Partial<StoreDraft>> {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['Expected a JSON object.'] };
  }

  const body = input as Record<string, unknown>;
  const draft: Partial<StoreDraft> = {};

  const require = (field: string) => {
    if (!partial) errors.push(`${field} is required.`);
  };

  // ---- name ----
  if (body.name === undefined) require('name');
  else if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    errors.push('name must be a non-empty string.');
  } else if (body.name.trim().length > MAX_NAME) {
    errors.push(`name must be at most ${MAX_NAME} characters.`);
  } else {
    draft.name = body.name.trim();
  }

  // ---- address ----
  if (body.address === undefined) require('address');
  else if (typeof body.address !== 'string' || body.address.trim().length === 0) {
    errors.push('address must be a non-empty string.');
  } else if (body.address.trim().length > MAX_ADDRESS) {
    errors.push(`address must be at most ${MAX_ADDRESS} characters.`);
  } else {
    draft.address = body.address.trim();
  }

  // ---- coordinates ----
  if (body.latitude === undefined) require('latitude');
  else if (!isValidLatitude(body.latitude)) {
    errors.push('latitude must be a number between -90 and 90.');
  } else {
    draft.latitude = body.latitude;
  }

  if (body.longitude === undefined) require('longitude');
  else if (!isValidLongitude(body.longitude)) {
    errors.push('longitude must be a number between -180 and 180.');
  } else {
    draft.longitude = body.longitude;
  }

  // ---- authorized egress CIDRs ----
  //
  // Validated strictly because this is the value the presence check trusts. A malformed
  // entry would silently never match, turning into a store that refuses every customer
  // for reasons nobody can see from the console.
  if (body.authorizedEgressCidrs === undefined) require('authorizedEgressCidrs');
  else if (!Array.isArray(body.authorizedEgressCidrs)) {
    errors.push('authorizedEgressCidrs must be an array.');
  } else if (body.authorizedEgressCidrs.length > MAX_CIDRS) {
    errors.push(`authorizedEgressCidrs must contain at most ${MAX_CIDRS} entries.`);
  } else {
    const invalid = body.authorizedEgressCidrs.filter(
      (entry) => typeof entry !== 'string' || !isValidCidr(entry)
    );
    if (invalid.length > 0) {
      errors.push(`Not valid CIDR notation: ${invalid.join(', ')}. Use a form like 203.0.113.10/32.`);
    } else {
      draft.authorizedEgressCidrs = (body.authorizedEgressCidrs as string[]).map((entry) =>
        entry.trim()
      );
    }
  }

  // ---- advertised SSID ----
  if (body.advertisedSsid === undefined) require('advertisedSsid');
  else if (typeof body.advertisedSsid !== 'string' || body.advertisedSsid.trim().length === 0) {
    errors.push('advertisedSsid must be a non-empty string.');
  } else if (body.advertisedSsid.trim().length > MAX_SSID) {
    errors.push(`advertisedSsid must be at most ${MAX_SSID} characters.`);
  } else {
    draft.advertisedSsid = body.advertisedSsid.trim();
  }

  // ---- merchant payment details (phase-1 direct-to-merchant model) ----
  //
  // Optional on create: a store is often registered before the retailer has supplied its
  // UPI details, and it should be shoppable in the meantime. `null` is an explicit
  // "not supplied yet", distinct from an absent key meaning "leave unchanged" on PATCH.
  if (body.merchantVpa === undefined) {
    if (!partial) draft.merchantVpa = null;
  } else if (body.merchantVpa === null || body.merchantVpa === '') {
    draft.merchantVpa = null;
  } else if (typeof body.merchantVpa !== 'string' || !VPA_PATTERN.test(body.merchantVpa.trim())) {
    errors.push('merchantVpa must be a UPI address like shopname@okhdfcbank, or null.');
  } else {
    draft.merchantVpa = body.merchantVpa.trim();
  }

  if (body.merchantDisplayName === undefined) {
    if (!partial) draft.merchantDisplayName = null;
  } else if (body.merchantDisplayName === null || body.merchantDisplayName === '') {
    draft.merchantDisplayName = null;
  } else if (typeof body.merchantDisplayName !== 'string') {
    errors.push('merchantDisplayName must be a string or null.');
  } else if (body.merchantDisplayName.trim().length > MAX_MERCHANT_NAME) {
    errors.push(`merchantDisplayName must be at most ${MAX_MERCHANT_NAME} characters.`);
  } else {
    draft.merchantDisplayName = body.merchantDisplayName.trim();
  }

  // ---- flags ----
  for (const flag of ['isActive', 'isOpen'] as const) {
    if (body[flag] === undefined) {
      // Both default to true on create: a store is added because it is about to be used.
      if (!partial) draft[flag] = true;
    } else if (typeof body[flag] !== 'boolean') {
      errors.push(`${flag} must be a boolean.`);
    } else {
      draft[flag] = body[flag] as boolean;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: draft };
}
