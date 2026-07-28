import 'server-only';
import { isValidLatitude, isValidLongitude } from './geo';
import { isValidCidr } from './memoryRepository';
import type { StoreDraft } from './types';

const MAX_NAME = 120;
const MAX_ADDRESS = 200;
const MAX_SSID = 64;
const MAX_CIDRS = 16;

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
