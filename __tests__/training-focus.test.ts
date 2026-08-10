import { describe, expect, it } from "vitest";

import {
  DEFAULT_SAMPLE_SIZE,
  focusExclusions,
  focusIsEmpty,
  sampleSizeFor,
  slotsForCategories,
} from "@/lib/outfit/training-focus";
import { BASE_SLOTS, buildSlate, type SlateCandidate } from "@/lib/outfit/slate";
import { mulberry32 } from "@/lib/outfit/sampling";
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

describe("slotsForCategories", () => {
  it("has no opinion when nothing is focused", () => {
    expect(slotsForCategories(undefined)).toBeNull();
    expect(slotsForCategories([])).toBeNull();
  });

  it("makes the chosen categories the shape of the outfit", () => {
    // The bug this fixes: focusing on jacket + shoes used to keep the default
    // top/bottom/shoes shape and filter the candidates, which emptied two
    // required slots and returned nothing at all.
    expect(slotsForCategories(["jacket", "shoes"])).toEqual([
      { kind: "outerwear" },
      { kind: "shoes" },
    ]);
  });

  it("orders slots head-to-toe regardless of how they were picked", () => {
    expect(slotsForCategories(["shoes", "hat", "pants", "shirt"])).toEqual([
      { kind: "accessory" },
      { kind: "top" },
      { kind: "bottom" },
      { kind: "shoes" },
    ]);
  });

  it("collapses categories that are the same kind into one slot", () => {
    // Two tops means "a top, from either" — not a shirt layered under a sweater.
    expect(slotsForCategories(["shirt", "sweater/hoodie"])).toEqual([{ kind: "top" }]);
    expect(slotsForCategories(["pants", "shorts"])).toEqual([{ kind: "bottom" }]);
  });
});

describe("a focused round actually builds", () => {
  const closet: SlateCandidate[] = [];
  const push = (id: string, category: string, name: string) =>
    closet.push({
      id,
      name,
      category,
      subcategory: null,
      material: null,
      pattern: null,
      colors: [{ name: "Black", hex: "#000000" }],
      season: [],
    });
  for (let i = 0; i < 3; i += 1) push(`jacket-${i}`, "jacket", `Jacket ${i}`);
  for (let i = 0; i < 5; i += 1) push(`shoes-${i}`, "shoes", `Shoes ${i}`);
  for (let i = 0; i < 5; i += 1) push(`shirt-${i}`, "shirt", `Shirt ${i}`);
  for (let i = 0; i < 5; i += 1) push(`pants-${i}`, "pants", `Pants ${i}`);

  it("returns jacket + shoes outfits for a jacket + shoes focus", () => {
    const categories = ["jacket", "shoes"];
    const out = buildSlate(closet, slotsForCategories(categories)!, {
      count: 6,
      exclude: focusExclusions(closet, { categories }),
      uniformStrategy: "explore",
      rng: mulberry32(5),
    });

    expect(out.length).toBeGreaterThan(1);
    for (const proposal of out) {
      expect(proposal.itemIds).toHaveLength(2);
      expect(proposal.itemIds.some((id) => id.startsWith("jacket-"))).toBe(true);
      expect(proposal.itemIds.some((id) => id.startsWith("shoes-"))).toBe(true);
    }
  });

  it("fills a round of eight from only three jackets", () => {
    // With "differ by two" on a two-piece outfit, three jackets could never
    // produce more than three proposals.
    const categories = ["jacket", "shoes"];
    const out = buildSlate(closet, slotsForCategories(categories)!, {
      count: 8,
      exclude: focusExclusions(closet, { categories }),
      uniformStrategy: "explore",
      rng: mulberry32(11),
    });
    expect(out.length).toBeGreaterThan(3);
    const keys = out.map((p) => [...p.itemIds].sort().join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("still builds the default three-piece shape with no category focus", () => {
    const out = buildSlate(closet, BASE_SLOTS, { count: 3, rng: mulberry32(3) });
    expect(out).toHaveLength(3);
    for (const proposal of out) expect(proposal.itemIds).toHaveLength(3);
  });
});
