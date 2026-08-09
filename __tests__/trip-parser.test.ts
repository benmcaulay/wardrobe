import { describe, it, expect } from "vitest";
import { parseTripText, parseTripTextWithKeywords, tripParserEnabled } from "../lib/services/tripParser";

// These exercise the keyless path, which is both the no-API-key default and the
// fallback whenever the model call fails — so it is the code that actually runs
// most of the time, not a placeholder.

describe("tripParserEnabled", () => {
  it("is off without the flag", () => {
    expect(tripParserEnabled()).toBe(false);
  });
});

describe("parseTripTextWithKeywords", () => {
  it("reads a wedding as a formal event", () => {
    const p = parseTripTextWithKeywords("5 days in Lisbon for my sister's wedding");
    expect(p.requirements.activities).toContain("formal");
  });

  it("picks up several activities from one sentence", () => {
    const p = parseTripTextWithKeywords("Conference in Berlin, then hiking in the mountains");
    expect(p.requirements.activities).toContain("business");
    expect(p.requirements.activities).toContain("hiking");
  });

  it("detects laundry only when stated", () => {
    expect(parseTripTextWithKeywords("two weeks, the flat has a washing machine").requirements.laundry).toBe(true);
    expect(parseTripTextWithKeywords("two weeks in Rome").requirements.laundry).toBe(false);
  });

  it("respects a negation", () => {
    expect(parseTripTextWithKeywords("a week camping, no laundry anywhere").requirements.laundry).toBe(false);
  });

  it("claims nothing when the text is vague", () => {
    // Under-claiming is the correct failure: a wrong activity silently
    // reshapes the whole bag, whereas an empty list just leaves the chips.
    const p = parseTripTextWithKeywords("going somewhere warm for a bit");
    expect(p.requirements.activities).toEqual([]);
    expect(p.confidence).toBeLessThan(0.2);
  });

  it("never invents an activity outside the known set", () => {
    const p = parseTripTextWithKeywords("scuba diving and paragliding and a safari");
    for (const a of p.requirements.activities) {
      expect(["beach", "hiking", "business", "formal", "city", "gym"]).toContain(a);
    }
  });

  it("reports low confidence so the UI keeps asking for confirmation", () => {
    expect(parseTripTextWithKeywords("beach week").confidence).toBeLessThan(0.6);
  });

  it("summarises what it found", () => {
    expect(parseTripTextWithKeywords("beach holiday").summary).toMatch(/beach/i);
    expect(parseTripTextWithKeywords("hmm").summary).toMatch(/couldn't/i);
  });
});

describe("parseTripText without a key", () => {
  it("falls back to keywords rather than throwing", async () => {
    const p = await parseTripText("a wedding in Lisbon and a beach day");
    expect(p.source).toBe("keywords");
    expect(p.requirements.activities).toContain("formal");
    expect(p.requirements.activities).toContain("beach");
  });

  it("returns an empty parse for empty input", async () => {
    const p = await parseTripText("   ");
    expect(p.requirements.activities).toEqual([]);
    expect(p.confidence).toBe(0);
  });

  it("never throws on junk", async () => {
    for (const junk of ["", "!!!", "🙂".repeat(50), "a".repeat(5000)]) {
      await expect(parseTripText(junk)).resolves.toBeTruthy();
    }
  });
});
