import 'server-only';
import { productRepository } from '../products';
import type { OrderLine } from './types';

/**
 * Turning a weight discrepancy into something a person at an exit can act on.
 *
 * `compareWeight` answers "does it match", which is the wrong shape for the job. A member
 * of staff holding a basket and a queue needs to know *what to look for*, and — just as
 * importantly — whether the number in front of them is trustworthy at all. Two things get
 * in the way of that, and both are computed here.
 *
 * ## 1. Items the check cannot see
 *
 * `import-csv.mjs` reads a missing weight as `Number(row.weight_grams || 0)`, so a product
 * with no weight in the sheet contributes nothing to the expected total. The consequence is
 * not merely that the item is unchecked — it is that a *scanned* zero-weight item makes the
 * basket read heavy by exactly its own weight, which is indistinguishable from an unscanned
 * item. Honest and dishonest baskets produce the same signal.
 *
 * The importer prints a note about this. Nobody at an exit ever sees it. So the coverage
 * travels with the order instead: staff are told the check covers ₹420 of ₹768 and which
 * items it cannot see, and can look at those three rather than distrust the whole figure.
 *
 * Left unsaid, this is what erodes the check: repeated unexplained mismatches on honest
 * baskets train staff to override reflexively, and an override that is always granted is
 * the same as having no gate.
 *
 * ## 2. Whether the gap could even be an item
 *
 * A tolerance is an abstraction. "The difference is 480 g, and nothing in this shop weighs
 * 480 g" is a fact, and it resolves the situation immediately. When something *does* match,
 * naming it turns a search into a check: *look for two packets of biscuits*.
 */

/** How close a candidate must come to the gap to be worth naming. */
function slackFor(gapGrams: number): number {
  // Proportional, with a floor for small gaps: a shop scale is not accurate to the gram,
  // and a candidate 20 g away from a 400 g gap is still the likely answer.
  return Math.max(30, Math.round(gapGrams * 0.05));
}

/** At most this many of one product considered — beyond it, everything "matches" something. */
const MAX_MULTIPLE = 3;

export interface WeightCoverage {
  totalUnits: number;
  /** Units whose weight is unknown, so they contribute nothing to the expected total. */
  uncheckedUnits: number;
  uncheckedNames: string[];
  checkedValuePaise: number;
  uncheckedValuePaise: number;
}

/**
 * How much of this basket the weight check actually covers.
 *
 * Value rather than weight is the denominator on purpose: "covers ₹420 of ₹768" tells
 * staff what is at stake, where "covers 9 of 12 items" does not distinguish a missing
 * biscuit packet from a missing bottle of saffron.
 */
export function coverageFor(lines: OrderLine[]): WeightCoverage {
  const coverage: WeightCoverage = {
    totalUnits: 0,
    uncheckedUnits: 0,
    uncheckedNames: [],
    checkedValuePaise: 0,
    uncheckedValuePaise: 0,
  };

  for (const line of lines) {
    coverage.totalUnits += line.quantity;

    if (line.expectedWeightGrams <= 0) {
      coverage.uncheckedUnits += line.quantity;
      coverage.uncheckedNames.push(line.name);
      coverage.uncheckedValuePaise += line.linePaise;
    } else {
      coverage.checkedValuePaise += line.linePaise;
    }
  }

  return coverage;
}

export interface GapCandidate {
  name: string;
  unitGrams: number;
  count: number;
  /** How far this candidate is from explaining the gap exactly. */
  residualGrams: number;
}

export interface GapExplanation {
  /** Always positive — the size of the discrepancy, whichever way it went. */
  gapGrams: number;
  /** The lightest thing this shop sells, or null if nothing has a usable weight. */
  lightestItemGrams: number | null;
  lightestItemName: string | null;
  /**
   * True when the gap is smaller than anything in the catalogue, which settles it: no
   * combination of stock explains a difference this small, so it is measurement error.
   */
  belowLightestItem: boolean;
  candidates: GapCandidate[];
}

/**
 * The catalogue, cached briefly.
 *
 * `listAllForStore` is a full read, and the exit desk hits this on every scan. Prices and
 * weights change on the order of days, so a short window costs nothing and keeps a busy
 * exit from scanning the product table once per customer.
 */
const CATALOGUE_TTL_MS = 60_000;
const catalogueCache = new Map<string, { at: number; items: { name: string; grams: number }[] }>();

async function catalogueFor(storeId: string): Promise<{ name: string; grams: number }[]> {
  const cached = catalogueCache.get(storeId);
  if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.items;

  const products = await productRepository.listAllForStore(storeId);
  const items = products
    .map((product) => ({ name: product.name, grams: product.expected_weight_grams }))
    // Zero-weight products cannot explain a gap, and would otherwise "match" every gap
    // at count 1 with a residual equal to the gap itself.
    .filter((item) => item.grams > 0);

  catalogueCache.set(storeId, { at: Date.now(), items });
  return items;
}

export async function explainGap(
  storeId: string,
  differenceGrams: number
): Promise<GapExplanation> {
  const gap = Math.abs(differenceGrams);
  const items = await catalogueFor(storeId);

  if (items.length === 0) {
    return {
      gapGrams: gap,
      lightestItemGrams: null,
      lightestItemName: null,
      belowLightestItem: false,
      candidates: [],
    };
  }

  const lightest = items.reduce((min, item) => (item.grams < min.grams ? item : min), items[0]);
  const slack = slackFor(gap);

  const candidates: GapCandidate[] = [];
  for (const item of items) {
    for (let count = 1; count <= MAX_MULTIPLE; count += 1) {
      const residual = Math.abs(gap - item.grams * count);
      if (residual <= slack) {
        candidates.push({
          name: item.name,
          unitGrams: item.grams,
          count,
          residualGrams: residual,
        });
        // The closest multiple of this product is the only one worth showing; two of the
        // same item at counts 2 and 3 is noise, not two different leads.
        break;
      }
    }
  }

  candidates.sort((a, b) => a.residualGrams - b.residualGrams);

  return {
    gapGrams: gap,
    lightestItemGrams: lightest.grams,
    lightestItemName: lightest.name,
    // The decisive case. Nothing in stock is this light, so no missing item explains it.
    belowLightestItem: gap < lightest.grams,
    candidates: candidates.slice(0, 4),
  };
}

/**
 * Whether the tolerance is wide enough to hide the lightest thing the shop sells.
 *
 * Large baskets earn a wider window than a small item weighs, and no tolerance rule fixes
 * that — tightening far enough to exclude a 200 g packet from a 20 kg basket would reject
 * honest baskets constantly. So the app states the limit instead of implying a guarantee
 * it cannot make, and the answer for those baskets is a spot re-scan, not a smaller number.
 */
export function hasBlindSpot(toleranceGrams: number, lightestItemGrams: number | null): boolean {
  return lightestItemGrams !== null && toleranceGrams >= lightestItemGrams;
}
