import { describe, it, expect } from "vitest";
import { daysBetween, isStaleListing, STALE_AFTER_DAYS } from "../lib/sale-listing";

const DAY = 1000 * 60 * 60 * 24;
const NOW = Date.UTC(2026, 5, 12);

describe("daysBetween", () => {
  it("counts whole days and floors", () => {
    expect(daysBetween(NOW - DAY * 5, NOW)).toBe(5);
    expect(daysBetween(NOW - DAY * 5 - DAY / 2, NOW)).toBe(5); // floors
    expect(daysBetween(NOW, NOW)).toBe(0);
  });
  it("never goes negative for future timestamps", () => {
    expect(daysBetween(NOW + DAY * 3, NOW)).toBe(0);
  });
});

describe("isStaleListing", () => {
  it("flags active listings idle for >= the threshold", () => {
    expect(isStaleListing({ status: "for_sale", updatedAtMs: NOW - DAY * STALE_AFTER_DAYS }, NOW)).toBe(true);
    expect(isStaleListing({ status: "listed", updatedAtMs: NOW - DAY * 30 }, NOW)).toBe(true);
  });

  it("does not flag recently-touched active listings", () => {
    expect(isStaleListing({ status: "for_sale", updatedAtMs: NOW - DAY * 3 }, NOW)).toBe(false);
    expect(isStaleListing({ status: "listed", updatedAtMs: NOW - DAY * (STALE_AFTER_DAYS - 1) }, NOW)).toBe(false);
  });

  it("never flags sold or kept listings, however old", () => {
    expect(isStaleListing({ status: "sold", updatedAtMs: NOW - DAY * 999 }, NOW)).toBe(false);
    expect(isStaleListing({ status: "skipped", updatedAtMs: NOW - DAY * 999 }, NOW)).toBe(false);
  });

  it("respects a custom staleness window", () => {
    expect(isStaleListing({ status: "for_sale", updatedAtMs: NOW - DAY * 5 }, NOW, 3)).toBe(true);
    expect(isStaleListing({ status: "for_sale", updatedAtMs: NOW - DAY * 5 }, NOW, 7)).toBe(false);
  });
});
