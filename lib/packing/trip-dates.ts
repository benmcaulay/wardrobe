/**
 * Formatting for trip dates.
 *
 * Trip start/end are *calendar dates*, not instants — "I leave on the 2nd" is
 * true regardless of where you are when you read it. They're stored as
 * Postgres timestamps at UTC midnight, so formatting them in the viewer's local
 * zone shifts them backwards anywhere west of UTC: a Jun 2–9 trip rendered as
 * "Jun 1 – Jun 8" for anyone in the Americas.
 *
 * Every trip date must therefore be formatted with `timeZone: "UTC"`, which is
 * what these helpers exist to guarantee. Don't call `toLocaleDateString` on a
 * trip date directly.
 *
 * (The edit form is unaffected — it slices the ISO string, which is already
 * UTC, rather than going through a Date.)
 */

/** The month/day part of a trip date, e.g. "Jun 2". */
export function formatTripDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

/**
 * A trip's date range, e.g. "Jun 2 – Jun 9". The year is added to the end when
 * the trip crosses into a different one, so a New Year trip isn't ambiguous.
 */
export function formatTripRange(start: string | Date, end: string | Date): string {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "";

  const crossesYear = startDate.getUTCFullYear() !== endDate.getUTCFullYear();
  return `${formatTripDate(startDate)} – ${formatTripDate(
    endDate,
    crossesYear
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" },
  )}`;
}
