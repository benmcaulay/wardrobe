import { describe, expect, it } from "vitest";
import { flagEmoji, localTimeAt, placeContext, placeLabel } from "@/lib/places";

describe("placeContext / placeLabel", () => {
  it("drops admin1 when it only repeats the name", () => {
    const seoul = { name: "Seoul", admin1: "Seoul", country: "South Korea" };
    expect(placeContext(seoul)).toBe("South Korea");
    expect(placeLabel(seoul)).toBe("Seoul, South Korea");
  });

  it("keeps admin1 when it disambiguates", () => {
    const springfield = { name: "Springfield", admin1: "Missouri", country: "United States" };
    expect(placeLabel(springfield)).toBe("Springfield, Missouri, United States");
  });

  it("survives a missing admin1", () => {
    expect(placeLabel({ name: "Monaco", admin1: null, country: "Monaco" })).toBe("Monaco, Monaco");
  });

  it("falls back to the bare name when there's no context at all", () => {
    expect(placeLabel({ name: "Nowhere", admin1: null, country: null })).toBe("Nowhere");
    expect(placeContext({ name: "Nowhere", admin1: null, country: null })).toBe("");
  });
});

describe("flagEmoji", () => {
  it("maps a country code to regional indicators", () => {
    expect(flagEmoji("KR")).toBe("🇰🇷");
    expect(flagEmoji("pt")).toBe("🇵🇹");
  });

  it("returns nothing for anything that isn't a two-letter code", () => {
    for (const value of [null, undefined, "", "K", "KOR", "K1", "12"]) {
      expect(flagEmoji(value)).toBe("");
    }
  });
});

describe("localTimeAt", () => {
  const noonUtc = new Date("2026-01-15T12:00:00Z");

  it("renders the destination's wall clock, not ours", () => {
    // Seoul is UTC+9 year-round, so noon UTC is 9pm there.
    expect(localTimeAt("Asia/Seoul", noonUtc)).toMatch(/9/);
    // Two different zones must not produce the same string for the same instant.
    expect(localTimeAt("Asia/Seoul", noonUtc)).not.toBe(
      localTimeAt("America/New_York", noonUtc),
    );
  });

  it("returns null rather than throwing on a zone we can't use", () => {
    expect(localTimeAt(null, noonUtc)).toBeNull();
    expect(localTimeAt("", noonUtc)).toBeNull();
    expect(localTimeAt("Not/AZone", noonUtc)).toBeNull();
  });
});
