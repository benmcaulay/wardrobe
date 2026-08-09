import { describe, it, expect } from "vitest";
import { formatTripDate, formatTripRange } from "../lib/packing/trip-dates";

// Trip dates are stored as UTC midnight, which is what makes the timezone
// handling load-bearing: formatted locally, every one of these shifts back a
// day for anyone west of UTC.
const JUN_2 = "2026-06-02T00:00:00.000Z";
const JUN_9 = "2026-06-09T00:00:00.000Z";

describe("formatTripDate", () => {
  it("renders the stored calendar date, not the local one", () => {
    expect(formatTripDate(JUN_2)).toBe("Jun 2");
    expect(formatTripDate(JUN_9)).toBe("Jun 9");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(formatTripDate(new Date(JUN_2))).toBe("Jun 2");
  });

  it("does not slip a day at a UTC-midnight boundary", () => {
    // Jan 1 at UTC midnight is Dec 31 in the Americas — the exact bug.
    expect(formatTripDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1");
  });

  it("returns empty string for an unparseable value rather than 'Invalid Date'", () => {
    expect(formatTripDate("not a date")).toBe("");
  });
});

describe("formatTripRange", () => {
  it("renders both ends of the trip", () => {
    expect(formatTripRange(JUN_2, JUN_9)).toBe("Jun 2 – Jun 9");
  });

  it("adds the year when the trip crosses into a new one", () => {
    const range = formatTripRange("2026-12-28T00:00:00.000Z", "2027-01-04T00:00:00.000Z");
    expect(range).toBe("Dec 28 – Jan 4, 2027");
  });

  it("omits the year within a single year", () => {
    expect(formatTripRange(JUN_2, JUN_9)).not.toMatch(/2026/);
  });

  it("handles a single-day trip", () => {
    expect(formatTripRange(JUN_2, JUN_2)).toBe("Jun 2 – Jun 2");
  });

  it("returns empty string when either end is unparseable", () => {
    expect(formatTripRange("nope", JUN_9)).toBe("");
    expect(formatTripRange(JUN_2, "nope")).toBe("");
  });
});
