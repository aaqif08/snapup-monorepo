import 'server-only';
import { isValidBarcode } from './barcodeFormat';
import type { ProductDraft } from './types';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** EAN/UPC: digits only. Matches the pattern the customer lookup route enforces. */


const MAX_NAME = 120;
const MAX_TEXT = 120;
/** ₹100,000 in paise. A price above this is far more likely a unit mix-up than a real one. */
const MAX_PRICE_PAISE = 10_000_000;

/**
 * Validates an operator-supplied product payload.
 *
 * Money is handled in **paise as integers** throughout, never rupees as floats. A price of
 * ₹40.10 held as 40.1 accumulates representation error the moment it is multiplied by a
 * quantity and summed, and a catalogue is exactly where that error gets minted. The
 * console converts for display; the wire and the store stay integral.
 */
export function validateProductDraft(
  input: unknown,
  { partial }: { partial: boolean }
): ValidationResult<Partial<ProductDraft>> {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['Expected a JSON object.'] };
  }

  const body = input as Record<string, unknown>;
  const draft: Partial<ProductDraft> = {};
  const requireField = (field: string) => {
    if (!partial) errors.push(`${field} is required.`);
  };

  const text = (field: keyof ProductDraft, max = MAX_TEXT, optional = false) => {
    const value = body[field];
    if (value === undefined) {
      if (!optional) requireField(field);
      return;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      if (optional && value === '') {
        (draft as Record<string, unknown>)[field] = '';
        return;
      }
      errors.push(`${field} must be a non-empty string.`);
      return;
    }
    if (value.trim().length > max) {
      errors.push(`${field} must be at most ${max} characters.`);
      return;
    }
    (draft as Record<string, unknown>)[field] = value.trim();
  };

  const integer = (field: keyof ProductDraft, { min, max }: { min: number; max: number }) => {
    const value = body[field];
    if (value === undefined) {
      requireField(field);
      return;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors.push(`${field} must be a whole number between ${min} and ${max}.`);
      return;
    }
    (draft as Record<string, unknown>)[field] = value;
  };

  // ---- identity ----
  text('store_id');
  text('name', MAX_NAME);
  text('category');

  // Optional: the aisle-traffic report falls back to category when this is unset, so a
  // catalogue uploaded without shelf locations still produces a usable location breakdown.
  if (body.aisle === undefined) {
    if (!partial) draft.aisle = null;
  } else if (body.aisle === null || body.aisle === '') {
    draft.aisle = null;
  } else if (typeof body.aisle !== 'string' || body.aisle.trim().length > MAX_TEXT) {
    errors.push(`aisle must be a string of at most ${MAX_TEXT} characters, or null.`);
  } else {
    draft.aisle = body.aisle.trim();
  }

  if (body.barcode === undefined) requireField('barcode');
  else if (typeof body.barcode !== 'string' || !isValidBarcode(body.barcode)) {
    errors.push('barcode must be 6-14 digits.');
  } else {
    draft.barcode = body.barcode.trim();
  }

  // ---- commercial ----
  integer('unit_price', { min: 0, max: MAX_PRICE_PAISE });
  integer('cost_price', { min: 0, max: MAX_PRICE_PAISE });
  integer('expected_weight_grams', { min: 1, max: 100_000 });
  integer('stock_quantity', { min: 0, max: 1_000_000 });

  // Selling below cost is legitimate (loss leaders, clearance) so it is not rejected —
  // but it is almost always a data-entry slip, so the console warns on it separately.
  text('supplier_name');
  text('supplier_contact');
  text('internal_sku');
  text('image_url', 300, true);

  if (body.is_active === undefined) {
    if (!partial) draft.is_active = true;
  } else if (typeof body.is_active !== 'boolean') {
    errors.push('is_active must be a boolean.');
  } else {
    draft.is_active = body.is_active;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: draft };
}
