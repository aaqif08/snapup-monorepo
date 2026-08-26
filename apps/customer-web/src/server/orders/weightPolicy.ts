import 'server-only';

/**
 * Does the basket on the scale match the basket in the app?
 *
 * ## The tolerance
 *
 * `±5%, or ±50g, whichever is larger.`
 *
 * Both halves earn their place. The percentage handles the fact that a 10 kg basket
 * accumulates more honest error than a 1 kg one: packaged goods vary from their printed
 * weight, and that variance compounds across items. The 50 g floor handles the opposite
 * end — 5% of a single 200 g biscuit packet is 10 g, which is finer than the shop's scale
 * can be trusted to read and would fail honest baskets on rounding alone.
 *
 * A tighter window builds a queue at the exit out of baskets that are fine. A looser one
 * stops being a check: 10% of a 10 kg basket is a full kilogram, comfortably enough to
 * conceal an item.
 *
 * ## What this does not decide
 *
 * Whether the customer may leave. A mismatch is information for the member of staff
 * standing there, not a verdict — they can approve anyway, and `mayApprove` says so. The
 * override is recorded against their user id precisely because it is allowed; see the
 * `weight_override_by` column. This function's only job is to say whether an override is
 * what is happening.
 */

export const WEIGHT_TOLERANCE_FRACTION = 0.05;
export const WEIGHT_TOLERANCE_FLOOR_GRAMS = 50;

export interface WeightComparison {
  expectedGrams: number;
  observedGrams: number;
  /** Signed: positive means the scale read heavier than the basket should be. */
  differenceGrams: number;
  /** The window actually applied, so the UI can show the number it was judged against. */
  toleranceGrams: number;
  matches: boolean;
  /**
   * Heavier is the direction that matters — it is what an unscanned item looks like.
   * Lighter usually means something was left behind or never picked up, which is a
   * different conversation with the customer.
   */
  direction: 'heavier' | 'lighter' | 'exact';
}

export function toleranceFor(expectedGrams: number): number {
  return Math.max(
    Math.round(expectedGrams * WEIGHT_TOLERANCE_FRACTION),
    WEIGHT_TOLERANCE_FLOOR_GRAMS
  );
}

export function compareWeight(expectedGrams: number, observedGrams: number): WeightComparison {
  const difference = observedGrams - expectedGrams;
  const tolerance = toleranceFor(expectedGrams);

  return {
    expectedGrams,
    observedGrams,
    differenceGrams: difference,
    toleranceGrams: tolerance,
    matches: Math.abs(difference) <= tolerance,
    direction: difference === 0 ? 'exact' : difference > 0 ? 'heavier' : 'lighter',
  };
}

/**
 * A scale reading that is not a number, is negative, or is absurd is a typo, not a
 * measurement. 250 kg is past any basket a person pushes and well past what a counter
 * scale reads; refusing it here stops a mistyped `12000` becoming a silent approval.
 */
export const MAX_PLAUSIBLE_BASKET_GRAMS = 250_000;

export function isPlausibleReading(grams: unknown): grams is number {
  return (
    typeof grams === 'number' &&
    Number.isFinite(grams) &&
    grams >= 0 &&
    grams <= MAX_PLAUSIBLE_BASKET_GRAMS
  );
}
