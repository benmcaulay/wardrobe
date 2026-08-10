import { describe, expect, it } from "vitest";

import {
  DEFAULT_SAMPLE_SIZE,
  focusExclusions,
  focusIsEmpty,
  sampleSizeFor,
} from "@/lib/outfit/training-focus";
import { SMART_TEMPERATURE, readSpinMode, spinScoringOptions } from "@/lib/outfit/spin-mode";
import type { OutfitPickItem } from "@/lib/outfit-random";

const item = (id: string, category: string, colorName: string): OutfitPickItem => ({
  id,
  category,
  colors: [{ name: colorName, hex: "#123456" }],
});

const closet: OutfitPickItem[] = [
  item("tee-black", "shirt", "Black"),
  item("tee-red", "shirt", "Red"),
  item("jeans-black", "jeans", "Black"),
  item("boots-brown", "boots", "Brown"),
];

describe("sampleSizeFor", () => {
  it("clamps pick and rate into 2–8", () => {
    expect(sampleSizeFor("pick", 5)).toBe(5);
    expect(sampleSizeFor("pick", 1)).toBe(2);
    expect(sampleSizeFor("pick", 99)).toBe(8);
    expect(sampleSizeFor("rate", 8)).toBe(8);
    expect(sampleSizeFor("rate", 0)).toBe(2);
  });

  it("ignores the setting for swipe, which is one at a time by definition", () => {
    expect(sampleSizeFor("swipe", 6)).toBe(1);
    expect(sampleSizeFor("swipe", 1)).toBe(1);
  });

  it("falls back to the default on junk rather than NaN-ing the round", () => {
    expect(sampleSizeFor("pick", undefined)).toBe(DEFAULT_SAMPLE_SIZE);
    expect(sampleSizeFor("pick", "many")).toBe(DEFAULT_SAMPLE_SIZE);
    expect(sampleSizeFor("pick", 4.7)).toBe(4);
  });
});

describe("focusExclusions", () => {
  it("excludes nothing when there's no focus", () => {
    expect(focusExclusions(closet, {})).toEqual(new Set());
    expect(focusIsEmpty({})).toBe(true);
  });

  it("keeps only the chosen categories", () => {
    const out = focusExclusions(closet, { categories: ["shirt"] });
    expect(out).toEqual(new Set(["jeans-black", "boots-brown"]));
  });

  it("keeps only the chosen colours", () => {
    const out = focusExclusions(closet, { colorNames: ["Black"] });
    expect(out).toEqual(new Set(["tee-red", "boots-brown"]));
  });

  it("applies category and colour together", () => {
    const out = focusExclusions(closet, { categories: ["shirt"], colorNames: ["Black"] });
    expect(out).toEqual(new Set(["tee-red", "jeans-black", "boots-brown"]));
  });

  it("never excludes a pinned piece, even one the filters would drop", () => {
    // Pinning is the more specific instruction: filtering away the very piece
    // you asked to train on would defeat the point.
    const out = focusExclusions(closet, {
      categories: ["shirt"],
      colorNames: ["Black"],
      pinnedItemIds: ["boots-brown"],
    });
    expect(out.has("boots-brown")).toBe(false);
    expect(focusIsEmpty({ pinnedItemIds: ["boots-brown"] })).toBe(false);
  });
});

describe("spinScoringOptions", () => {
  it("gives random spins no scoring at all, so every legal outfit is equally likely", () => {
    expect(spinScoringOptions("random")).toBeUndefined();
    expect(spinScoringOptions("random", { band: "cold" })).toBeUndefined();
  });

  it("hands smart spins the learned affinity and today's band", () => {
    const affinity = new Map([["tee-black", 0.9]]);
    const options = spinScoringOptions("smart", { affinity, band: "cool" });
    expect(options?.context?.affinity).toBe(affinity);
    expect(options?.context?.band).toBe("cool");
    expect(options?.temperature).toBe(SMART_TEMPERATURE);
  });

  it("still scores a smart spin with no signals yet, on compatibility alone", () => {
    const options = spinScoringOptions("smart");
    expect(options).toBeDefined();
    expect(options?.context?.band).toBeNull();
    expect(options?.context?.affinity).toBeUndefined();
  });
});

describe("readSpinMode", () => {
  it("defaults to smart for anything unrecognised", () => {
    expect(readSpinMode("random")).toBe("random");
    expect(readSpinMode("smart")).toBe("smart");
    expect(readSpinMode(undefined)).toBe("smart");
    expect(readSpinMode("SMART")).toBe("smart");
  });
});
