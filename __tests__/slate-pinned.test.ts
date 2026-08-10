import { describe, expect, it } from "vitest";

import { mulberry32 } from "@/lib/outfit/sampling";
import { BASE_SLOTS, buildSlate, slotsForPinned, type SlateCandidate } from "@/lib/outfit/slate";

/** A closet wide enough that the sampler has real choices to make. */
function closet(): SlateCandidate[] {
  const items: SlateCandidate[] = [];
  const push = (id: string, category: string, name: string) =>
    items.push({
      id,
      name,
      category,
      subcategory: null,
      material: null,
      pattern: null,
      colors: [{ name: "Black", hex: "#000000" }],
      season: [],
    });

  for (let i = 0; i < 6; i += 1) push(`top-${i}`, "shirt", `Shirt ${i}`);
  for (let i = 0; i < 6; i += 1) push(`bottom-${i}`, "jeans", `Jeans ${i}`);
  for (let i = 0; i < 6; i += 1) push(`shoes-${i}`, "sneakers", `Sneakers ${i}`);
  push("hat-0", "hat", "Cap");
  return items;
}

const rng = () => mulberry32(7);

describe("buildSlate sample size", () => {
  it("returns the three-way split when asked for three", () => {
    const out = buildSlate(closet(), BASE_SLOTS, { count: 3, rng: rng() });
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.strategy)).toEqual(["safe", "alternative", "explore"]);
  });

  it("builds more than three when a training round asks for more", () => {
    // The old plan was a hardcoded three entries, so count was silently capped.
    const out = buildSlate(closet(), BASE_SLOTS, { count: 8, rng: rng() });
    expect(out).toHaveLength(8);
    // Everything past the alternative is another exploration arm.
    expect(new Set(out.slice(2).map((p) => p.strategy))).toEqual(new Set(["explore"]));
  });

  it("keeps every proposal distinct", () => {
    const out = buildSlate(closet(), BASE_SLOTS, { count: 5, rng: rng() });
    const keys = out.map((p) => [...p.itemIds].sort().join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildSlate pinned pieces", () => {
  it("puts the pinned piece in every proposal", () => {
    const out = buildSlate(closet(), BASE_SLOTS, {
      count: 5,
      pinned: ["top-2"],
      rng: rng(),
    });
    expect(out.length).toBeGreaterThan(1);
    for (const proposal of out) expect(proposal.itemIds).toContain("top-2");
  });

  it("still returns a full round when a pin makes proposals overlap", () => {
    // Three slots with one pinned leaves two free pieces, so the plain
    // "differ by two" bar would reject everything after the first.
    const out = buildSlate(closet(), BASE_SLOTS, {
      count: 4,
      pinned: ["bottom-1"],
      rng: rng(),
    });
    expect(out).toHaveLength(4);
    const keys = out.map((p) => [...p.itemIds].sort().join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not charge a pinned choice to the policy's propensity", () => {
    const [pinnedProposal] = buildSlate(closet(), BASE_SLOTS, {
      count: 1,
      pinned: ["top-2", "bottom-1", "shoes-3"],
      rng: rng(),
    });
    // Every piece was fixed by the user, so the policy chose nothing.
    expect(pinnedProposal.propensity).toBe(1);
  });

  it("refuses rather than dropping a pin it cannot seat", () => {
    // A hat has no slot in the base top/bottom/shoes shape.
    const out = buildSlate(closet(), BASE_SLOTS, { count: 3, pinned: ["hat-0"], rng: rng() });
    expect(out).toEqual([]);
  });
});

describe("slotsForPinned", () => {
  it("adds an optional slot for a kind the base shape doesn't cover", () => {
    const items = closet();
    const slots = slotsForPinned(items, ["hat-0"], BASE_SLOTS);
    expect(slots).toHaveLength(BASE_SLOTS.length + 1);
    expect(slots.at(-1)).toEqual({ kind: "accessory", optional: true });

    // …and with that slot the pin is seatable.
    const out = buildSlate(items, slots, { count: 2, pinned: ["hat-0"], rng: rng() });
    expect(out.length).toBeGreaterThan(0);
    for (const proposal of out) expect(proposal.itemIds).toContain("hat-0");
  });

  it("leaves the shape alone when the pins already fit", () => {
    expect(slotsForPinned(closet(), ["top-1"], BASE_SLOTS)).toEqual([...BASE_SLOTS]);
    expect(slotsForPinned(closet(), [], BASE_SLOTS)).toEqual([...BASE_SLOTS]);
  });
});
