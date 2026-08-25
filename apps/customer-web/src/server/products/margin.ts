import 'server-only';

/**
 * Gross margin as a percentage, to one decimal place.
 *
 * Shared by both repositories rather than duplicated into each. This is a derived column —
 * every write recomputes it from `unit_price` and `cost_price` — so two copies of the
 * formula would eventually round differently and the owner's dashboard would disagree with
 * itself depending on which storage backend wrote the row.
 *
 * Guards zero and negative prices: a free or mispriced item reports 0% rather than
 * dividing by zero and storing `Infinity` or `NaN`, either of which would poison every
 * aggregate that touched it.
 */
export function marginPct(unitPrice: number, costPrice: number): number {
  if (unitPrice <= 0) return 0;
  return Math.round(((unitPrice - costPrice) / unitPrice) * 1000) / 10;
}
