import { describe, it, expect } from "vitest";
import {
  MAX_PRICE_POINTS,
  appendPricePoint,
  daysSinceCheck,
  detectPriceDrop,
  latestPriceCents,
  parsePriceHistory,
} from "../lib/wishlist/price-watch";

describe("parsePriceHistory", () => {
  it("round-trips a valid history", () => {
    const raw = JSON.stringify([{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }]);
    expect(parsePriceHistory(raw)).toEqual([{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }]);
  });

  it("returns empty for null, junk, and non-arrays", () => {
    expect(parsePriceHistory(null)).toEqual([]);
    expect(parsePriceHistory("")).toEqual([]);
    expect(parsePriceHistory("{not json")).toEqual([]);
    expect(parsePriceHistory('{"cents":1}')).toEqual([]);
  });

  it("drops malformed points instead of the whole history", () => {
    const raw = JSON.stringify([
      { cents: 1000, at: "2026-01-01T00:00:00.000Z" },
      { cents: "500", at: "2026-01-02T00:00:00.000Z" },
      { cents: 0, at: "2026-01-03T00:00:00.000Z" },
      { cents: 900 },
      { cents: 800, at: "2026-01-04T00:00:00.000Z" },
    ]);
    expect(parsePriceHistory(raw)).toEqual([
      { cents: 1000, at: "2026-01-01T00:00:00.000Z" },
      { cents: 800, at: "2026-01-04T00:00:00.000Z" },
    ]);
  });
});

describe("appendPricePoint", () => {
  it("appends a changed price", () => {
    const next = appendPricePoint(
      [{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }],
      900,
      "2026-01-02T00:00:00.000Z",
    );
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ cents: 900, at: "2026-01-02T00:00:00.000Z" });
  });

  it("ignores a repeat of the current price so history records changes, not polls", () => {
    const history = [{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }];
    expect(appendPricePoint(history, 1000, "2026-01-02T00:00:00.000Z")).toEqual(history);
  });

  it("re-records a price that bounced away and back", () => {
    const history = [
      { cents: 1000, at: "2026-01-01T00:00:00.000Z" },
      { cents: 800, at: "2026-01-02T00:00:00.000Z" },
    ];
    expect(appendPricePoint(history, 1000, "2026-01-03T00:00:00.000Z")).toHaveLength(3);
  });

  it("rejects non-positive and non-finite readings", () => {
    const history = [{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }];
    expect(appendPricePoint(history, 0, "x")).toEqual(history);
    expect(appendPricePoint(history, -5, "x")).toEqual(history);
    expect(appendPricePoint(history, NaN, "x")).toEqual(history);
  });

  it("keeps the tail bounded", () => {
    let history = [{ cents: 1, at: "2026-01-01T00:00:00.000Z" }];
    for (let i = 2; i < MAX_PRICE_POINTS + 20; i += 1) {
      history = appendPricePoint(history, i, `2026-01-01T00:00:0${i % 10}.000Z`);
    }
    expect(history).toHaveLength(MAX_PRICE_POINTS);
    // Oldest points fell off the front.
    expect(history[0].cents).toBeGreaterThan(1);
  });
});

describe("detectPriceDrop", () => {
  it("returns null with fewer than two points", () => {
    expect(detectPriceDrop([])).toBeNull();
    expect(detectPriceDrop([{ cents: 1000, at: "2026-01-01T00:00:00.000Z" }])).toBeNull();
  });

  it("measures the drop against the highest price seen", () => {
    const drop = detectPriceDrop([
      { cents: 8_000, at: "2026-01-01T00:00:00.000Z" },
      { cents: 10_000, at: "2026-01-02T00:00:00.000Z" },
      { cents: 7_000, at: "2026-01-03T00:00:00.000Z" },
    ]);
    expect(drop).toEqual({
      fromCents: 10_000,
      toCents: 7_000,
      dropCents: 3_000,
      dropPercent: 30,
      at: "2026-01-03T00:00:00.000Z",
    });
  });

  it("still reports a discount when a sale partially rebounds", () => {
    const drop = detectPriceDrop([
      { cents: 10_000, at: "2026-01-01T00:00:00.000Z" },
      { cents: 5_000, at: "2026-01-02T00:00:00.000Z" },
      { cents: 8_000, at: "2026-01-03T00:00:00.000Z" },
    ]);
    expect(drop?.fromCents).toBe(10_000);
    expect(drop?.toCents).toBe(8_000);
    expect(drop?.dropPercent).toBe(20);
  });

  it("returns null when the price only rose", () => {
    expect(
      detectPriceDrop([
        { cents: 5_000, at: "2026-01-01T00:00:00.000Z" },
        { cents: 9_000, at: "2026-01-02T00:00:00.000Z" },
      ]),
    ).toBeNull();
  });
});

describe("latestPriceCents", () => {
  it("reads the last point, or null when empty", () => {
    expect(latestPriceCents([])).toBeNull();
    expect(
      latestPriceCents([
        { cents: 1, at: "a" },
        { cents: 2, at: "b" },
      ]),
    ).toBe(2);
  });
});

describe("daysSinceCheck", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");

  it("returns null when never checked", () => {
    expect(daysSinceCheck(null, now)).toBeNull();
    expect(daysSinceCheck(undefined, now)).toBeNull();
  });

  it("counts whole days from a Date or an ISO string", () => {
    expect(daysSinceCheck(new Date("2026-01-07T00:00:00.000Z"), now)).toBe(3);
    expect(daysSinceCheck("2026-01-09T12:00:00.000Z", now)).toBe(0);
  });

  it("clamps a future timestamp to zero", () => {
    expect(daysSinceCheck("2026-02-01T00:00:00.000Z", now)).toBe(0);
  });
});
