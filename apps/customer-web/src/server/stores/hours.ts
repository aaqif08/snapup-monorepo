import 'server-only';

/**
 * Opening hours, as minutes since local midnight.
 *
 * The unit is the whole design. A shop's hours are wall-clock facts about a building —
 * "we open at nine" — not instants, so storing them as timestamps would attach a date and
 * a zone to something that has neither, and would need converting back every time anyone
 * looked. Minutes since midnight survive a backup, a restore and a daylight-saving
 * boundary unchanged, and render to the same string the owner typed.
 */

export const MINUTES_IN_DAY = 24 * 60;

/** `"09:30"` → 570. Returns null for anything that is not a 24-hour clock time. */
export function parseClockTime(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 570 → `"09:30"`. The inverse, for form fields and the API. */
export function formatClockTime(minutes: number): string {
  const safe = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Is the shop open at this moment?
 *
 * `null` means the hours are not stated, and the caller should fall back to the manual
 * flag rather than guess — an unstated schedule is not the same as a closed one, and
 * treating it as closed would hide every branch registered before someone confirmed its
 * times.
 *
 * Overnight hours are the case worth reading. When closing is numerically *before*
 * opening — 22:00 to 02:00 — the open window wraps midnight, so the test inverts: open
 * means after opening **or** before closing, where a normal day means after opening
 * **and** before closing.
 */
export function isOpenAt(
  opensAtMinutes: number | null,
  closesAtMinutes: number | null,
  at: Date = new Date()
): boolean | null {
  if (opensAtMinutes === null || closesAtMinutes === null) return null;

  const now = at.getHours() * 60 + at.getMinutes();

  // A shop stating identical open and close times is stating "always open" rather than
  // "open for zero minutes" — the latter is never what anybody means by 00:00–00:00.
  if (opensAtMinutes === closesAtMinutes) return true;

  return closesAtMinutes > opensAtMinutes
    ? now >= opensAtMinutes && now < closesAtMinutes
    : now >= opensAtMinutes || now < closesAtMinutes;
}

/** `"09:00 – 21:30"`, or null when the hours are not stated. */
export function describeHours(
  opensAtMinutes: number | null,
  closesAtMinutes: number | null
): string | null {
  if (opensAtMinutes === null || closesAtMinutes === null) return null;
  if (opensAtMinutes === closesAtMinutes) return 'Open 24 hours';
  return `${formatClockTime(opensAtMinutes)} – ${formatClockTime(closesAtMinutes)}`;
}
