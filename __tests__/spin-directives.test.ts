import { describe, expect, it } from "vitest";
import { pickRandomOutfit, type OutfitPickItem, type OutfitSlotInput } from "@/lib/outfit-random";
import { spinScoringOptions } from "@/lib/outfit/spin-mode";
import { mulberry32 } from "@/lib/outfit/sampling";
import type { SessionDirective } from "@/lib/outfit/directives";

function pool(): OutfitPickItem[] {
  const items: OutfitPickItem[] = [];
  const push = (id: string, category: string, color: string) =>
    items.push({ id, category, colors: [{ name: color, hex: "#000" }], categoryPath: [category] });
  for (let i = 0; i < 9; i += 1) push(`hat-${i}`, "hat", i === 0 ? "Red" : "Black");
  for (let i = 0; i < 9; i += 1) push(`shirt-${i}`, "shirt", "Black");
  return items;
}
const slots: OutfitSlotInput[] = [
  { id: "s-hat", categories: ["hat"] },
  { id: "s-top", categories: ["shirt"] },
];
const redHat: SessionDirective = {
  kind: "include", id: "d1", text: "a red hat", category: "hat", terms: ["red"],
};

/** Share of spins that seated the one red hat. */
function redRate(directives: SessionDirective[], mode: "random" | "smart"): number {
  let hits = 0;
  const runs = 60;
  for (let seed = 0; seed < runs; seed += 1) {
    const opts = spinScoringOptions(mode, {}, directives);
    const got = pickRandomOutfit(pool(), slots, [], opts ? { ...opts, rng: mulberry32(seed) } : undefined);
    if (got && [...got.values()].includes("hat-0")) hits += 1;
  }
  return hits / runs;
}

describe("spin honours session directives", () => {
  it("a random spin without directives picks the red hat about 1 in 9", () => {
    expect(redRate([], "random")).toBeLessThan(0.35);
  });

  it("a random spin with the directive picks it nearly always", () => {
    // The point of DIRECTIVE_TEMPERATURE: at the default 0.125 this sat near
    // 0.67, which reads as the instruction being ignored a third of the time.
    // Bounded rather than pinned: the rate is a sampling result, and an
    // assertion sitting exactly on the observed value fails half the time.
    expect(redRate([redHat], "random")).toBeGreaterThan(0.9);
  });

  it("random stays random: no directives means no scoring at all", () => {
    expect(spinScoringOptions("random", {})).toBeUndefined();
  });

  it("a directive turns scoring on without turning compatibility on", () => {
    const opts = spinScoringOptions("random", {}, [redHat]);
    expect(opts?.useCompatibility).toBe(false);
    expect(opts?.directives).toHaveLength(1);
  });

  it("smart spins keep compatibility and add the directive", () => {
    const opts = spinScoringOptions("smart", {}, [redHat]);
    expect(opts?.useCompatibility).not.toBe(false);
    expect(opts?.directives).toHaveLength(1);
  });
});
