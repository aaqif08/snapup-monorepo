import 'server-only';

/**
 * What counts as a barcode.
 *
 * ## Why this is no longer "6 to 14 digits"
 *
 * That rule described EAN-8, EAN-13 and UPC, which is what a retail barcode almost always
 * is. The supplied pilot catalogue is not: SnapMart's 547 SKUs carry `SNAP0000000001`
 * through `SNAP0000000547`, printed as Code 128 — a symbology that encodes letters
 * perfectly well and is the usual choice for a shop's own internal labels.
 *
 * Rejecting them meant every scan of the actual pilot data returned `invalid_barcode`
 * before the catalogue was ever consulted. The rule was describing one symbology and being
 * applied as though it described all of them.
 *
 * ## What the rule is now
 *
 * Uppercase letters, digits and hyphens, 6 to 32 characters. Wide enough for EAN, UPC,
 * Code 128 and a retailer's own scheme; narrow enough that this still rejects the thing a
 * validator on a path segment exists to reject — anything carrying a slash, a quote, a
 * space or a control character, which is the shape of an injection attempt rather than a
 * product.
 *
 * Length is bounded on both sides deliberately. A six-character floor keeps a stray
 * keystroke from being treated as a lookup, and a 32-character ceiling keeps an unbounded
 * string out of a query and out of the logs.
 */
const BARCODE_PATTERN = /^[A-Z0-9-]{6,32}$/;

export const BARCODE_RULE = 'Barcodes are 6–32 characters: letters, digits and hyphens.';

/**
 * Case is folded up, not down.
 *
 * Scanners report Code 128 in the case it was encoded, and the supplied catalogue is
 * uppercase. Folding here means a barcode typed by hand at the exit — or read by a scanner
 * that reports lowercase — still finds the product, rather than failing in a way nobody
 * can see from the label.
 */
export function normaliseBarcode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidBarcode(raw: string): boolean {
  return BARCODE_PATTERN.test(normaliseBarcode(raw));
}
