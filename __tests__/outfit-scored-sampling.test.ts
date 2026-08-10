import { describe, expect, it } from "vitest";
import { pickRandomOutfit, type OutfitPickItem, type OutfitSlotInput } from "@/lib/outfit-random";
import { scoreOutfit } from "@/lib/outfit/compatibility";
import { mulberry32 } from "@/lib/outfit/sampling";

/**
 * The Phase 1 claim is behavioural, not structural: swapping the uniform
 * shuffle for compatibility-weighted sampling should visibly raise the quality
 * of what the builder returns, without narrowing what it can reach. Both halves
 * matter — a scorer that only ever returns its single favourite outfit would
 * score wonderfully and make the button useless.
 */

const color = (hex: string, name: string) => [{ hex, name }];

/** A closet with a clear right answer: neutral tailoring, plus loud outliers. */
const CLOSET: OutfitPickItem[] = [
  { id: "top-black", category: "top", name: "Merino knit", colors: color("#000000", "black") },
  { id: "top-white", category: "top", name: "Oxford shirt", colors: color("#ffffff", "white") },
  { id: "top-navy", category: "top", name: "Silk blouse", colors: color("#1a2a4a", "navy") },
  { id: "top-lime", category: "top", name: "Running jersey", colors: color("#9cd91e", "chartreuse") },
  { id: "top-red", category: "top", name: "Graphic tee", colors: color("#c81e1e", "red") },

  { id: "bot-grey", category: "bottom", name: "Wool trousers", colors: color("#888888", "grey") },
  { id: "bot-black", category: "bottom", name: "Dress trousers", colors: color("#111111", "black") },
  { id: "bot-orange", category: "bottom", name: "Fleece sweatpants", colors: color("#d97a1e", "orange") },
  { id: "bot-pink", category: "bottom", name: "Board shorts", colors: color("#e01e8c", "pink") },

  { id: "shoe-black", category: "shoes", name: "Leather loafer", colors: color("#1a1a1a", "black") },
  { id: "shoe-white", category: "shoes", name: "Canvas sneaker", colors: color("#f0f0f0", "white") },
  { id: "shoe-teal", category: "shoes", name: "Running trainers", colors: color("#1ec8c8", "teal") },
];

const SLOTS: OutfitSlotInput[] = [
  { id: "s1", categories: ["top"] },
  { id: "s2", categories: ["bottom"] },
  { id: "s3", categories: ["shoes"] },
];

function spin(seed: number, scored: boolean): number | null {
  const rng = mulberry32(seed);
  const assignment = pickRandomOutfit(
    CLOSET,
    SLOTS,
    [],
    // Uniform sampling ignores the injected rng (it uses Math.random inside
    // `shuffle`), which is fine: we only need many independent draws, not
    // reproducible ones, to compare the two distributions.
    scored ? { rng } : undefined,
  );
  if (!assignment) return null;

  const items = [...assignment.values()]
    .map((id) => CLOSET.find((item) => item.id === id))
    .filter((item): item is OutfitPickItem => !!item);
  return scoreOutfit(items).score;
}

function sample(scored: boolean, runs = 300): number[] {
  const scores: number[] = [];
  for (let seed = 0; seed < runs; seed += 1) {
    const score = spin(seed, scored);
    if (score != null) scores.push(score);
  }
  return scores;
}

const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

describe("scored sampling in the outfit builder", () => {
  it("produces better outfits on average than the uniform shuffle", () => {
    const uniform = mean(sample(false));
    const scored = mean(sample(true));
    expect(scored).toBeGreaterThan(uniform);
  });

  it("still reaches a wide range of outfits, so the button stays worth pressing", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const assignment = pickRandomOutfit(CLOSET, SLOTS, [], { rng: mulberry32(seed) });
      if (assignment) seen.add([...assignment.values()].sort().join(","));
    }
    // 5 tops × 4 bottoms × 3 shoes = 60 combinations. A deterministic ranker
    // would return 1; we want most of the space to stay live.
    expect(seen.size).toBeGreaterThan(15);
  });

  it("never violates the hard slot constraints", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const assignment = pickRandomOutfit(CLOSET, SLOTS, [], { rng: mulberry32(seed) });
      expect(assignment).not.toBeNull();
      const items = [...assignment!.values()].map((id) => CLOSET.find((i) => i.id === id)!);
      expect(items.map((i) => i.category).sort()).toEqual(["bottom", "shoes", "top"]);
      expect(new Set(items.map((i) => i.id)).size).toBe(3);
    }
  });

  it("respects a locked slot and builds around it", () => {
    const locked: OutfitSlotInput[] = [
      { id: "s1", categories: ["top"], lockedItemId: "top-lime" },
      { id: "s2", categories: ["bottom"] },
      { id: "s3", categories: ["shoes"] },
    ];
    for (let seed = 0; seed < 30; seed += 1) {
      const assignment = pickRandomOutfit(CLOSET, locked, [], { rng: mulberry32(seed) });
      expect(assignment?.get("s1")).toBe("top-lime");
    }
  });

  it("still honours colour rules, which are hard constraints not preferences", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const assignment = pickRandomOutfit(CLOSET, SLOTS, [{ colorName: "black", count: 2 }], {
        rng: mulberry32(seed),
      });
      expect(assignment).not.toBeNull();
      const blacks = [...assignment!.values()]
        .map((id) => CLOSET.find((i) => i.id === id)!)
        .filter((item) => item.colors[0]?.name === "black");
      expect(blacks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("lowering the temperature concentrates on the better outfits", () => {
    const adventurous = mean(
      Array.from({ length: 200 }, (_, seed) => {
        const a = pickRandomOutfit(CLOSET, SLOTS, [], { rng: mulberry32(seed), temperature: 1 });
        return a ? scoreOutfit([...a.values()].map((id) => CLOSET.find((i) => i.id === id)!)).score : 0;
      }),
    );
    const safe = mean(
      Array.from({ length: 200 }, (_, seed) => {
        const a = pickRandomOutfit(CLOSET, SLOTS, [], { rng: mulberry32(seed), temperature: 0.05 });
        return a ? scoreOutfit([...a.values()].map((id) => CLOSET.find((i) => i.id === id)!)).score : 0;
      }),
    );
    expect(safe).toBeGreaterThan(adventurous);
  });
});
