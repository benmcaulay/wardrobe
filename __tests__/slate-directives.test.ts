import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/outfit/sampling";
import { BASE_SLOTS, buildSlate, type SlateCandidate } from "@/lib/outfit/slate";
import type { SessionDirective } from "@/lib/outfit/directives";

/** One red shirt among many black ones, so a colour directive has work to do. */
function closet(): SlateCandidate[] {
  const items: SlateCandidate[] = [];
  const push = (id: string, category: string, name: string, color: string) =>
    items.push({
      id, name, category, subcategory: null, material: null, pattern: null,
      colors: [{ name: color, hex: "#000000" }], season: [],
    });
  for (let i = 0; i < 8; i += 1) push(`top-${i}`, "shirt", `Shirt ${i}`, "Black");
  push("top-red", "shirt", "Red Shirt", "Red");
  for (let i = 0; i < 8; i += 1) push(`bottom-${i}`, "jeans", `Jeans ${i}`, "Black");
  for (let i = 0; i < 8; i += 1) push(`shoes-${i}`, "sneakers", `Sneakers ${i}`, "Black");
  return items;
}

const redShirt: SessionDirective = {
  kind: "include", id: "d1", text: "a red shirt", category: "shirt", terms: ["red"],
};

describe("buildSlate with session directives", () => {
  it("seats the requested garment it would otherwise rarely pick", () => {
    const without = buildSlate(closet(), BASE_SLOTS, { count: 3, rng: mulberry32(7) });
    const withIt = buildSlate(closet(), BASE_SLOTS, {
      count: 3, rng: mulberry32(7), directives: [redShirt],
    });
    const has = (ps: ReturnType<typeof buildSlate>) =>
      ps.filter((p) => p.itemIds.includes("top-red")).length;
    // 1 red of 9 shirts: the directive should carry it into every proposal.
    expect(has(withIt)).toBeGreaterThan(has(without));
    expect(has(withIt)).toBe(3);
  });

  it("reports nothing unmet when the directive is honoured", () => {
    const out = buildSlate(closet(), BASE_SLOTS, {
      count: 3, rng: mulberry32(7), directives: [redShirt],
    });
    expect(out.every((p) => (p.unmet ?? []).length === 0)).toBe(true);
  });

  it("still returns full outfits when nothing can satisfy it", () => {
    // The whole point of soft directives: an impossible ask must not blank
    // the screen, it must say it could not be met.
    const impossible: SessionDirective = {
      kind: "include", id: "d2", text: "a purple hat", category: "hat", terms: ["purple"],
    };
    const out = buildSlate(closet(), BASE_SLOTS, {
      count: 3, rng: mulberry32(7), directives: [impossible],
    });
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.itemIds.length >= 3)).toBe(true);
    expect(out.every((p) => (p.unmet ?? []).includes("d2"))).toBe(true);
  });

  it("changes nothing when no directives are given", () => {
    const a = buildSlate(closet(), BASE_SLOTS, { count: 3, rng: mulberry32(11) });
    const b = buildSlate(closet(), BASE_SLOTS, { count: 3, rng: mulberry32(11), directives: [] });
    expect(b.map((p) => p.itemIds)).toEqual(a.map((p) => p.itemIds));
  });
});
