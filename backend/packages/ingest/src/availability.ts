// =============================================================================
// esperanza-cf — human-readable QMI availability text ("Available JUN/JUL 2026").
//
// The public site's availability badge renders qmi.availability_text — it
// de-prefixes "Available " and shows the remainder as the move-in display value,
// falling back to the raw ISO date ONLY when availability_text is absent (that ISO
// fallback must never be what visitors see). This module derives the text from the
// effective move-in date so ingest-created/updated homes always carry it.
//
// Convention (confirmed against live D1 values on 2026-06-11):
//   * Two-month window: move-in month + the following month, uppercase 3-letter
//     English month abbreviations, single 4-digit year suffix taken from the
//     SECOND month — "Available JUN/JUL 2026". For non-boundary windows the
//     second month's year equals the move-in year (matches every observed row);
//     across the year boundary it rolls forward — "Available DEC/JAN 2027".
//   * Move-in date today-or-earlier → "Available Now".
//   * No / unparseable date → null (leave the field absent; never write junk).
// =============================================================================

const MONTHS_ABBR = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/** Today as a UTC YYYY-MM-DD string (the same calendar space as D1 dates). */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * First value that is neither null/undefined nor blank-after-trim, TRIMMED. Unlike `??`,
 * this skips the empty strings the Snowflake parser produces for null text columns
 * (String(x ?? '').trim()), where `'' ?? fallback` would yield '' and read as a real
 * value. Lives here, beside the gate, because BOTH the producer (diff.ts) and the queue
 * consumer resolve effective override→feed→D1 values with it and the two must not drift.
 *
 * The result is trimmed because it is also the value the publish intent carries and the
 * consumer compare-and-sets on in SQL (`COALESCE(NULLIF(TRIM(override),''), …) IS ?`).
 * Returning the raw value would let a padded ' Buyer Sign Off ' from the feed compare
 * unequal to its own trimmed column expression and silently refuse to publish.
 */
export function firstFilled(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    const s = v == null ? '' : String(v).trim();
    if (s !== '') return s;
  }
  return null;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Parse an EXACT YYYY-MM-DD string that is also a real day on the calendar.
 * Returns null for a wrong-length/shape string, a trailing suffix of any kind, a
 * month outside 1-12, or a day past that month's real length (Feb 29 honours the
 * Gregorian leap rule; Feb 30, Apr 31, Jun 31, Sep 31, Nov 31 are all rejected).
 *
 * Exists because a shape-only check plus a lexicographic `<=` treats an impossible
 * date as a valid one: '2026-02-31' sorts inside any horizon ending later in the
 * year, so the publish gate would accept a home whose move-in date does not exist.
 * Every one of the 375 non-null synced_move_in_date and 41 override_move_in_date
 * values in production is exactly 10 chars and a real calendar day (checked
 * 2026-07-28), so demanding the exact shape rejects nothing that is live today —
 * it closes the door on a corrupt feed value, which is the only way one arrives.
 */
export function parseIsoCalendarDate(
  value: string | null | undefined
): { year: number; month: number; day: number; iso: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  // month is already proven 1-12, so the ?? branch is unreachable; it satisfies
  // noUncheckedIndexedAccess and fails closed (rejects the date) if it ever were not.
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day < 1 || day > maxDay) return null;
  return { year, month, day, iso: `${m[1]}-${m[2]}-${m[3]}` };
}

/**
 * Derive the canonical availability text from an effective move-in date
 * (YYYY-MM-DD, as stored in synced_move_in_date / override_move_in_date).
 *
 * Returns null when the date is missing or unparseable — callers must then
 * leave availability_text untouched/absent.
 *
 * `todayIso` is injectable for tests; defaults to the current UTC date.
 */
/**
 * Construction stages that mean the home is move-in ready NOW. Sourced from the
 * MarkSystems milestone chain (DM_HOUSE.CONSTRUCTION_STAGE): 'Buyer Sign Off' is the
 * final in-inventory stage (settled homes are filtered out upstream). Confirmed
 * against the legacy O'Neill listing on 2026-06-16: 49/50 "Available Now" homes were
 * at 'Buyer Sign Off'; every windowed home sat at an earlier stage. Case-insensitive.
 */
const READY_STAGES = new Set(['buyer sign off']);

export function isReadyConstructionStage(stage: string | null | undefined): boolean {
  return READY_STAGES.has(String(stage ?? '').trim().toLowerCase());
}

// ── Auto-publish horizon ─────────────────────────────────────────────────────
// How far out a still-under-construction home may be and still be worth showing
// as available inventory.
//
// Derived from the legacy O'Neill listing rather than assumed. Scrape of
// www.esperanzahomes.com/new-homes/available/ on 2026-07-28 (121 homes):
//   Available Now 44 · JUL/AUG 20 · AUG/SEP 23 · SEP/OCT 15 · OCT/NOV 13 ·
//   NOV/DEC 4 · MAY/JUN + JUN/JUL 2 · nothing in 2027 at all.
// The envelope stops dead at NOV/DEC 2026 — ~120 days out from that date. So 120
// days reproduces the business rule the sales side has been running for years.
//
// Without this gate the auto-publish leg (diff.ts) published on presence-in-Snowflake
// + has-an-image alone, which put graded pads and "Preliminary Plan Review" rows on
// the site with move-in dates as far out as 2027-02-26 (2026-07-28 incident: published
// QMIs went 112 → 262).
export const PUBLISH_HORIZON_DAYS = 120;

/** todayIso + days, as a YYYY-MM-DD string. UTC calendar space, same as D1 dates. */
export function addDays(todayIso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayIso.trim());
  if (!m) return todayIso;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * True when an effective move-in date is inside the publish horizon. A missing date,
 * a malformed one, or one that is not a real calendar day is NOT within the horizon —
 * we refuse to publish a home whose timing we cannot establish, since the availability
 * badge would have nothing honest to say.
 *
 * Strict (parseIsoCalendarDate) rather than shape-only on purpose: this comparison is
 * lexicographic, so an impossible date like '2026-02-31' would otherwise sort inside
 * the horizon and publish. The gate is the fail-closed side of this module — see
 * deriveAvailabilityText for why *rendering* is deliberately more forgiving.
 */
export function isWithinPublishHorizon(
  isoDate: string | null | undefined,
  todayIso: string = todayIsoDate(),
  horizonDays: number = PUBLISH_HORIZON_DAYS
): boolean {
  const parsed = parseIsoCalendarDate(isoDate);
  if (!parsed) return false;
  return parsed.iso <= addDays(todayIso, horizonDays);
}

// The earliest construction milestone the legacy sales roster exposes. The numeric
// sequence comes from DM_HOUSE.CONSTRUCTION_STAGE_INDEX; index 8 is Pour Foundation.
// Names are authoritative because some valid finished homes arrive with a NULL index.
export const PUBLISH_STAGE_FLOOR_INDEX = 8;
const PUBLISHABLE_STAGES = new Set([
  'pour foundation',
  'frame labor 1',
  'hang drywall',
  'tile labor',
  'install countertops',
  'paint final',
  'buyer sign off',
]);

export function isAtOrAbovePublishStageFloor(
  stage: string | null | undefined,
  stageIndex: number | null | undefined
): boolean {
  const normalized = String(stage ?? '').trim().toLowerCase();
  if (PUBLISHABLE_STAGES.has(normalized)) return true;
  return Number.isFinite(stageIndex) && Number(stageIndex) >= PUBLISH_STAGE_FLOOR_INDEX;
}

/**
 * The auto-publish readiness gate: a home may be published unattended only when it
 * has physically reached Pour Foundation (or later) AND is finished or due inside
 * the horizon. Requiring both prevents early-stage inventory from rolling back onto
 * the site merely because the 120-day date window advances.
 *
 * `constructionStageIndex` is optional for compatibility with older queued callers.
 * Known milestone names are authoritative: Snowflake has emitted NULL indexes for
 * valid Buyer Sign Off homes, which must remain publishable.
 *
 * `effectiveMoveInDate` must be override_move_in_date ?? synced/Snowflake move-in date —
 * the same COALESCE the public views apply, so the gate judges what a visitor would see.
 */
export function isPublishReady(
  constructionStage: string | null | undefined,
  effectiveMoveInDate: string | null | undefined,
  todayIso: string = todayIsoDate(),
  horizonDays: number = PUBLISH_HORIZON_DAYS,
  constructionStageIndex: number | null | undefined = null
): boolean {
  if (!isAtOrAbovePublishStageFloor(constructionStage, constructionStageIndex)) return false;
  if (isReadyConstructionStage(constructionStage)) return true;
  return isWithinPublishHorizon(effectiveMoveInDate, todayIso, horizonDays);
}

/**
 * NOTE ON STRICTNESS — deliberately NOT the gate's strict parser.
 *
 * The output here is month-granular ("Available FEB/MAR 2026"), so the day-of-month is
 * not an input to it at all: a corrupt '2026-02-31' still yields exactly the right
 * window. Rejecting it would return null, which leaves availability_text absent, and an
 * absent availability_text makes the badge fall back to the raw ISO date — putting the
 * literal string "2026-02-31" in front of a visitor. That is strictly worse output than
 * the correct month window, so this stays prefix-tolerant.
 *
 * The asymmetry is the point, and it runs in the safe direction: the GATE fails closed
 * (a date it cannot fully trust never publishes a home), while RENDERING degrades
 * gracefully (given a date, say the most sensible true thing about it). A corrupt date
 * therefore cannot put a home on the site, and if a human publishes one by hand anyway,
 * the badge still reads sensibly.
 */
export function deriveAvailabilityText(
  isoDate: string | null | undefined,
  todayIso: string = todayIsoDate(),
  constructionStage: string | null | undefined = null
): string | null {
  // A completed home is "Available Now" regardless of its (now-irrelevant) estimated
  // move-in date — this is the primary signal; the date window is only for homes still
  // under construction. Also fixes stale future-window text on homes that have finished.
  if (isReadyConstructionStage(constructionStage)) return 'Available Now';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((isoDate ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Past or imminent (today counts): the home is move-in ready.
  const dateKey = `${m[1]}-${m[2]}-${m[3]}`;
  if (dateKey <= todayIso) return 'Available Now';

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `Available ${MONTHS_ABBR[month - 1]}/${MONTHS_ABBR[nextMonth - 1]} ${nextYear}`;
}

/**
 * True when a stored availability_text matches the machine-generated convention
 * ("Available JUN/JUL 2026" / "Available Now") — i.e. it is safe for ingest to
 * refresh. Anything else (admin-authored copy like "Move in this fall!") is
 * treated as an admin override and is NEVER clobbered. availability_text is a
 * plain column (no synced_/override_ pair), so this pattern check IS the
 * no-clobber rule. Stale auto values (window text whose date has since moved)
 * still match and are correctly refreshed.
 */
export function isAutoAvailabilityText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (t === '') return true; // empty → nothing to clobber
  return /^Available ((JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{4}|Now)$/.test(
    t
  );
}
