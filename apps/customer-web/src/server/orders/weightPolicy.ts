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

/**
 * `toleranceGrams` is passed in rather than derived from the total, because the honest
 * window depends on what the basket is made of and not merely what it weighs — see
 * `toleranceForLines`. Omitted, it falls back to the flat rule, which keeps the simple
 * two-argument form usable for a comparison that has no lines to hand.
 */
export function compareWeight(
  expectedGrams: number,
  observedGrams: number,
  toleranceGrams?: number
): WeightComparison {
  const difference = observedGrams - expectedGrams;
  const tolerance = toleranceGrams ?? toleranceFor(expectedGrams);

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

/**
 * Per-unit weight variation, one standard deviation, as a fraction of the item's own
 * weight.
 *
 * Packaged goods are filled to a target, not to an exact figure, and 2% is a fair working
 * estimate across dry goods and liquids. It is an assumption rather than a measurement —
 * if the pilot shows baskets failing honestly, this is the number to raise, and raising it
 * is a one-line change precisely because it lives here.
 */
export const PER_UNIT_VARIATION = 0.02;

/** Three sigma: roughly one honest basket in 370 falls outside, which a person can absorb. */
export const SIGMA_MULTIPLIER = 3;

export interface WeighedLine {
  /** Line total — `unit weight × quantity`, matching `OrderLine.expectedWeightGrams`. */
  expectedWeightGrams: number;
  quantity: number;
}

/**
 * Tolerance from the composition of the basket rather than from its total.
 *
 * ## Why not a flat percentage
 *
 * A flat 5% assumes error grows in proportion to the basket, and it does not. Per-item
 * errors are independent, so they add in quadrature — twenty items carry about √20 ≈ 4.5
 * times one item's error, not twenty times. Charging the basket a linear penalty therefore
 * hands large baskets a hiding space that grows with every item added, which is exactly
 * backwards: a twenty-item basket is where an extra item is easiest to conceal.
 *
 * A concrete case from the pilot catalogue: twenty 200 g packets total 4 kg. Flat 5% allows
 * ±200 g — a full extra packet, plus change. Quadrature at three sigma allows ±54 g, and
 * rejects the packet.
 *
 * ## The clamp
 *
 * Never looser than the flat rule this replaced, and never tighter than the floor. The
 * upper clamp matters: if the assumption above turns out to be optimistic, the worst this
 * can do is behave exactly as the previous rule did, rather than inventing a wider window
 * than anyone signed off.
 */
export function toleranceForLines(lines: WeighedLine[]): number {
  let expectedTotal = 0;
  let variance = 0;

  for (const line of lines) {
    expectedTotal += line.expectedWeightGrams;

    // Each *unit* varies independently, so a line of six contributes six variances rather
    // than one large one. Dividing back out is why quantity is needed here at all.
    const quantity = Math.max(1, line.quantity);
    const unitGrams = line.expectedWeightGrams / quantity;
    const unitSigma = unitGrams * PER_UNIT_VARIATION;
    variance += quantity * unitSigma * unitSigma;
  }

  const statistical = Math.round(SIGMA_MULTIPLIER * Math.sqrt(variance));
  const flat = Math.round(expectedTotal * WEIGHT_TOLERANCE_FRACTION);

  return Math.max(WEIGHT_TOLERANCE_FLOOR_GRAMS, Math.min(flat, statistical));
}
