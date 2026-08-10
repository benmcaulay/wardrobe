import { describe, expect, it } from "vitest";
import {
  CONFIDENT_WEAR_THRESHOLD,
  effectiveConfidence,
  isConfidentWear,
  rollUpWearEvents,
  wornOnFromISODate,
  wornOnFromLocalDate,
  wornOnToISODate,
} from "@/lib/wear/rollup";

const day = (iso: string) => wornOnFromISODate(iso)!;

describe("rollUpWearEvents", () => {
  it("returns an empty rollup for no events", () => {
    expect(rollUpWearEvents([])).toEqual({
      timesWorn: 0,
      effectiveWears: 0,
      lastWornAt: null,
      lastInferredWearOn: null,
    });
  });

  it("counts only confident wears in timesWorn but all of them in effectiveWears", () => {
    const rollup = rollUpWearEvents([
      { wornOn: day("2026-01-10"), confidence: 1 },
      { wornOn: day("2026-02-10"), confidence: 0.4 },
      { wornOn: day("2026-03-10"), confidence: 0.6 },
    ]);
    expect(rollup.timesWorn).toBe(1);
    expect(rollup.effectiveWears).toBeCloseTo(2, 6);
  });

  it("keeps lastWornAt on the newest confident wear, ignoring weak guesses", () => {
    const rollup = rollUpWearEvents([
      { wornOn: day("2026-01-10"), confidence: 1 },
      { wornOn: day("2026-07-01"), confidence: 0.4 },
    ]);
    // The user-facing "last worn" must not move on a 0.4 camera-roll guess.
    expect(wornOnToISODate(rollup.lastWornAt!)).toBe("2026-01-10");
    // ...but the dormancy model still needs to know something happened in July.
    expect(wornOnToISODate(rollup.lastInferredWearOn!)).toBe("2026-07-01");
  });

  it("treats a confirmed inference as fact regardless of its original score", () => {
    const confirmed = { wornOn: day("2026-05-05"), confidence: 0.2, confirmedAt: new Date() };
    expect(effectiveConfidence(confirmed)).toBe(1);
    expect(isConfidentWear(confirmed)).toBe(true);

    const rollup = rollUpWearEvents([confirmed]);
    expect(rollup.timesWorn).toBe(1);
    expect(rollup.effectiveWears).toBe(1);
    expect(wornOnToISODate(rollup.lastWornAt!)).toBe("2026-05-05");
  });

  it("ignores zero- and negative-confidence rows entirely", () => {
    const rollup = rollUpWearEvents([
      { wornOn: day("2026-01-01"), confidence: 0 },
      { wornOn: day("2026-01-02"), confidence: -1 },
      { wornOn: day("2026-01-03"), confidence: Number.NaN },
    ]);
    expect(rollup).toEqual({
      timesWorn: 0,
      effectiveWears: 0,
      lastWornAt: null,
      lastInferredWearOn: null,
    });
  });

  it("does not accumulate float error across many partial wears", () => {
    const events = Array.from({ length: 300 }, (_, i) => ({
      wornOn: day("2026-01-01"),
      confidence: 0.1 + (i % 3) * 0.1,
    }));
    const rollup = rollUpWearEvents(events);
    // Would otherwise print as e.g. 59.99999999999994 in any debug view.
    expect(Number.isInteger(rollup.effectiveWears * 1e6)).toBe(true);
  });

  it("sits the threshold above what an unconfirmed photo match can reach", () => {
    // PHOTO_CONFIDENCE_CEILING is 0.7 — inference must never self-promote to fact.
    expect(CONFIDENT_WEAR_THRESHOLD).toBeGreaterThan(0.7);
  });
});

describe("wornOn date handling", () => {
  it("parses an ISO date to UTC midnight", () => {
    const parsed = wornOnFromISODate("2026-03-09")!;
    expect(parsed.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("rejects malformed and impossible dates instead of rolling them over", () => {
    expect(wornOnFromISODate("not-a-date")).toBeNull();
    expect(wornOnFromISODate("2026-3-9")).toBeNull();
    // Would silently become 2026-03-03 via Date's rollover.
    expect(wornOnFromISODate("2026-02-31")).toBeNull();
  });

  it("round-trips through the ISO formatter", () => {
    expect(wornOnToISODate(wornOnFromISODate("2026-12-31")!)).toBe("2026-12-31");
  });

  it("reads the local calendar date, not the UTC one", () => {
    // 11pm on the 9th in a UTC-7 zone is already the 10th in UTC. The wear
    // belongs to the 9th — the day the user experienced.
    const local = new Date(2026, 7, 9, 23, 30);
    expect(wornOnToISODate(wornOnFromLocalDate(local))).toBe("2026-08-09");
  });
});
