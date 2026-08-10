import { describe, expect, it } from "vitest";
import {
  isValidRule,
  itemIsForbidden,
  itemMatchesTerm,
  pairIsForbidden,
  preferenceBonus,
  PREFER_BOOST,
  type AttributedRule,
} from "@/lib/outfit/style-rules";
import { buildSlate, BASE_SLOTS, type SlateCandidate } from "@/lib/outfit/slate";
import { mulberry32 } from "@/lib/outfit/sampling";
import { parseStyleNoteWithKeywords } from "@/lib/services/styleNoteParser";

/** Minimal RuleItem; term rules read category/subcategory/name.
 *  Named `ri`, not `it` — an `it` helper shadows vitest's own and silently
 *  collects zero tests. */
const ri = (id: string, category = "", name = "") => ({ id, category, name });

const attributed = (rule: AttributedRule["rule"]): AttributedRule => ({
  rule,
  noteId: "note-1",
  noteText: "test note",
});

describe("pairIsForbidden", () => {
  const rules = [attributed({ kind: "avoid_pair", itemIds: ["hat", "shirt"] })];

  it("blocks the pair in either order", () => {
    expect(pairIsForbidden([ri("hat")], ri("shirt"), rules)).not.toBeNull();
    expect(pairIsForbidden([ri("shirt")], ri("hat"), rules)).not.toBeNull();
  });

  it("allows each item on its own", () => {
    expect(pairIsForbidden([ri("jeans")], ri("hat"), rules)).toBeNull();
    expect(pairIsForbidden([], ri("shirt"), rules)).toBeNull();
  });

  it("reports which note blocked it, so the UI can say why", () => {
    expect(pairIsForbidden([ri("hat")], ri("shirt"), rules)?.noteText).toBe("test note");
  });
});

describe("itemIsForbidden", () => {
  it("bans an item outright", () => {
    const rules = [attributed({ kind: "avoid_item", itemId: "hat" })];
    expect(itemIsForbidden(ri("hat"), rules)).not.toBeNull();
    expect(itemIsForbidden(ri("shirt"), rules)).toBeNull();
  });

  it("applies a conditional ban only when the condition matches", () => {
    const rules = [
      attributed({ kind: "avoid_item_context", itemId: "coat", bands: ["hot", "warm"] }),
    ];
    expect(itemIsForbidden(ri("coat"), rules, { band: "hot" })).not.toBeNull();
    expect(itemIsForbidden(ri("coat"), rules, { band: "cold" })).toBeNull();
  });

  it("does not fire a conditional ban when the condition can't be evaluated", () => {
    // No forecast today. "Too warm above 20°C" must not silently become an
    // unconditional ban just because we don't know the weather.
    const rules = [
      attributed({ kind: "avoid_item_context", itemId: "coat", bands: ["hot"] }),
    ];
    expect(itemIsForbidden(ri("coat"), rules, {})).toBeNull();
    expect(itemIsForbidden(ri("coat"), rules, { band: null })).toBeNull();
  });

  it("matches on occasion as well as weather", () => {
    const rules = [
      attributed({ kind: "avoid_item_context", itemId: "tee", occasions: ["work", "formal"] }),
    ];
    expect(itemIsForbidden(ri("tee"), rules, { occasion: "work" })).not.toBeNull();
    expect(itemIsForbidden(ri("tee"), rules, { occasion: "everyday" })).toBeNull();
  });
});

describe("preferenceBonus", () => {
  it("boosts a preferred pair", () => {
    const rules = [attributed({ kind: "prefer_pair", itemIds: ["jeans", "boots"] })];
    expect(preferenceBonus([ri("jeans")], ri("boots"), rules)).toBeCloseTo(PREFER_BOOST, 10);
    expect(preferenceBonus([ri("jeans")], ri("loafers"), rules)).toBe(0);
  });

  it("stays soft — avoidance is hard, preference only tilts", () => {
    // A preference that could dominate would collapse the closet onto the same
    // outfit after two or three notes.
    expect(PREFER_BOOST).toBeLessThan(0.15);
  });

  it("ignores avoid rules entirely — those are exclusions, not penalties", () => {
    const rules = [attributed({ kind: "avoid_pair", itemIds: ["hat", "shirt"] })];
    expect(preferenceBonus([ri("hat")], ri("shirt"), rules)).toBe(0);
  });
});

describe("term-pair rules (kind-level habits)", () => {
  const rules = [attributed({ kind: "avoid_term_pair", terms: ["boot", "short"] })];
  const boots = ri("b1", "Shoes", "Chelsea Boots");
  const shorts = ri("s1", "Shorts", "Board Shorts");
  const jeans = ri("j1", "Pants", "Selvedge Jeans");
  const sneakers = ri("k1", "Shoes", "Canvas Sneaker");

  it("blocks any boots with any shorts, in either order", () => {
    expect(pairIsForbidden([boots], shorts, rules)).not.toBeNull();
    expect(pairIsForbidden([shorts], boots, rules)).not.toBeNull();
  });

  it("leaves other combinations alone", () => {
    expect(pairIsForbidden([boots], jeans, rules)).toBeNull();
    expect(pairIsForbidden([sneakers], shorts, rules)).toBeNull();
  });

  it("applies to a garment the user did not own when they wrote the rule", () => {
    // The whole point of a kind rule: it covers next year's boots too.
    const newBoots = ri("b2", "Shoes", "Blundstone Boot");
    expect(pairIsForbidden([newBoots], shorts, rules)).not.toBeNull();
  });

  it("boosts a preferred kind pair", () => {
    const prefer = [attributed({ kind: "prefer_term_pair", terms: ["boot", "jean"] })];
    expect(preferenceBonus([boots], jeans, prefer)).toBeCloseTo(PREFER_BOOST, 10);
  });
});

describe("itemMatchesTerm", () => {
  it("matches on category, subcategory or name", () => {
    expect(itemMatchesTerm({ id: "a", category: "Shorts" }, "short")).toBe(true);
    expect(itemMatchesTerm({ id: "a", name: "Chelsea Boots" }, "boot")).toBe(true);
    expect(itemMatchesTerm({ id: "a", subcategory: "loafer" }, "loafer")).toBe(true);
  });

  it("respects word boundaries, so 'boot' does not match 'bootcut jeans'", () => {
    // The exact collision classifyGarmentKind documents — a bootcut jean is a
    // bottom, and a boots-with-shorts rule must not silently ban it.
    expect(itemMatchesTerm({ id: "a", name: "Bootcut Jeans" }, "boot")).toBe(false);
    expect(itemMatchesTerm({ id: "a", name: "Short Sleeve Shirt" }, "short")).toBe(true);
  });

  it("tolerates a plural on either side", () => {
    expect(itemMatchesTerm({ id: "a", name: "Boots" }, "boot")).toBe(true);
    expect(itemMatchesTerm({ id: "a", name: "Boot" }, "boot")).toBe(true);
  });

  it("is false for an empty term", () => {
    expect(itemMatchesTerm({ id: "a", name: "Boots" }, "  ")).toBe(false);
  });
});

describe("isValidRule", () => {
  const known = new Set(["a", "b"]);

  it("accepts well-formed rules over known items", () => {
    expect(isValidRule({ kind: "avoid_pair", itemIds: ["a", "b"] }, known)).toBe(true);
    expect(isValidRule({ kind: "avoid_item", itemId: "a" }, known)).toBe(true);
  });

  it("rejects ids the note was not written about", () => {
    // The parser's allow-list. A hallucinated id must never reach the scorer.
    expect(isValidRule({ kind: "avoid_pair", itemIds: ["a", "ghost"] }, known)).toBe(false);
    expect(isValidRule({ kind: "avoid_item", itemId: "ghost" }, known)).toBe(false);
  });

  it("rejects a self-pair and malformed shapes", () => {
    expect(isValidRule({ kind: "avoid_pair", itemIds: ["a", "a"] }, known)).toBe(false);
    expect(isValidRule({ kind: "avoid_pair", itemIds: ["a"] }, known)).toBe(false);
    expect(isValidRule({ kind: "nonsense", itemId: "a" }, known)).toBe(false);
    expect(isValidRule(null, known)).toBe(false);
  });

  it("accepts a term pair without consulting the closet allow-list", () => {
    // Terms are words, not ids — they deliberately reference garments the user
    // does not own yet.
    expect(isValidRule({ kind: "avoid_term_pair", terms: ["boot", "short"] }, known)).toBe(true);
  });

  it("rejects term pairs that would match half the wardrobe", () => {
    expect(isValidRule({ kind: "avoid_term_pair", terms: ["a", "short"] }, known)).toBe(false);
    expect(isValidRule({ kind: "avoid_term_pair", terms: ["boot", "boot"] }, known)).toBe(false);
    expect(isValidRule({ kind: "avoid_term_pair", terms: ["boot"] }, known)).toBe(false);
  });

  it("rejects a conditional rule with no conditions", () => {
    // Otherwise it is an unconditional ban wearing a conditional label —
    // either a parser slip or a much broader rule than the user wrote.
    expect(isValidRule({ kind: "avoid_item_context", itemId: "a" }, known)).toBe(false);
    expect(isValidRule({ kind: "avoid_item_context", itemId: "a", bands: [] }, known)).toBe(false);
    expect(
      isValidRule({ kind: "avoid_item_context", itemId: "a", bands: ["cold"] }, known),
    ).toBe(true);
  });
});

describe("parseStyleNoteWithKeywords", () => {
  const subjects = [
    { id: "hat-1", name: "Nike Nocta Cap", category: "hat" },
    { id: "shirt-1", name: "Kingdom T", category: "shirt" },
    { id: "shoe-1", name: "Black 9060", category: "shoes" },
  ];

  it("turns a negative two-garment note into an avoid_pair", () => {
    const parsed = parseStyleNoteWithKeywords("don't put that hat with that shirt", subjects);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]).toEqual({ kind: "avoid_pair", itemIds: ["hat-1", "shirt-1"] });
  });

  it("turns a negative single-garment note into an avoid_item", () => {
    const parsed = parseStyleNoteWithKeywords("stop suggesting that hat", subjects);
    expect(parsed.rules[0]).toEqual({ kind: "avoid_item", itemId: "hat-1" });
  });

  it("reads a positive note as a preference, not an avoidance", () => {
    const parsed = parseStyleNoteWithKeywords("the hat goes with those shoes", subjects);
    expect(parsed.rules[0]).toEqual({ kind: "prefer_pair", itemIds: ["hat-1", "shoe-1"] });
  });

  it("matches a distinctive word from the garment's own name", () => {
    const parsed = parseStyleNoteWithKeywords("never wear the Kingdom tee to work", subjects);
    expect(parsed.rules[0]).toEqual({ kind: "avoid_item", itemId: "shirt-1" });
  });

  it("reads a kind-level habit as a term pair, not two specific garments", () => {
    // "I don't wear boots with shorts" must cover every boot and every pair of
    // shorts, including ones bought later — not whichever two were on screen.
    const parsed = parseStyleNoteWithKeywords("I don't wear boots with shorts", subjects);
    expect(parsed.rules[0]).toEqual({ kind: "avoid_term_pair", terms: ["boot", "short"] });
  });

  it("says nothing when the note is vague", () => {
    // Silence is the correct output: a wrong hard constraint silently removes
    // outfits the user never asked to lose.
    expect(parseStyleNoteWithKeywords("looks a bit off today", subjects).rules).toEqual([]);
    expect(parseStyleNoteWithKeywords("nice", subjects).rules).toEqual([]);
  });

  it("says nothing when it can't tell which garments are meant", () => {
    expect(parseStyleNoteWithKeywords("don't do that again", subjects).rules).toEqual([]);
  });
});

describe("rules applied to the slate", () => {
  const color = (hex: string, name: string) => [{ hex, name }];
  const CLOSET: SlateCandidate[] = [
    { id: "t1", category: "top", name: "Merino knit", colors: color("#000000", "black") },
    { id: "t2", category: "top", name: "Oxford shirt", colors: color("#ffffff", "white") },
    { id: "b1", category: "bottom", name: "Wool trousers", colors: color("#888888", "grey") },
    { id: "b2", category: "bottom", name: "Selvedge jeans", colors: color("#26364f", "indigo") },
    { id: "s1", category: "shoes", name: "Leather loafer", colors: color("#1a1a1a", "black") },
    { id: "s2", category: "shoes", name: "Canvas sneaker", colors: color("#f0f0f0", "white") },
  ];

  it("never proposes a banned item", () => {
    const rules = [attributed({ kind: "avoid_item", itemId: "t1" })];
    for (let seed = 0; seed < 40; seed += 1) {
      for (const proposal of buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), rules })) {
        expect(proposal.itemIds).not.toContain("t1");
      }
    }
  });

  it("never proposes a forbidden pair, while still using each item separately", () => {
    const rules = [attributed({ kind: "avoid_pair", itemIds: ["t1", "b1"] })];
    let sawT1 = false;
    let sawB1 = false;

    for (let seed = 0; seed < 80; seed += 1) {
      for (const proposal of buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), rules })) {
        const hasT1 = proposal.itemIds.includes("t1");
        const hasB1 = proposal.itemIds.includes("b1");
        expect(hasT1 && hasB1).toBe(false);
        sawT1 ||= hasT1;
        sawB1 ||= hasB1;
      }
    }
    // The rule is about the combination, not the garments — banning either
    // outright would be a much bigger constraint than the user wrote.
    expect(sawT1).toBe(true);
    expect(sawB1).toBe(true);
  });

  it("still builds outfits when a rule constrains the closet", () => {
    const rules = [attributed({ kind: "avoid_pair", itemIds: ["t1", "b1"] })];
    expect(buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(1), rules }).length).toBeGreaterThan(0);
  });

  it("honours a weather-conditional ban only in that weather", () => {
    const rules = [
      attributed({ kind: "avoid_item_context", itemId: "t1", bands: ["hot"] }),
    ];
    const hot = buildSlate(CLOSET, BASE_SLOTS, {
      rng: mulberry32(2),
      rules,
      ruleContext: { band: "hot" },
    });
    const cold = buildSlate(CLOSET, BASE_SLOTS, {
      rng: mulberry32(2),
      rules,
      ruleContext: { band: "cold" },
    });
    expect(hot.every((p) => !p.itemIds.includes("t1"))).toBe(true);
    expect(cold.some((p) => p.itemIds.includes("t1"))).toBe(true);
  });

  it("favours a preferred pair without making it mandatory", () => {
    const rules = [attributed({ kind: "prefer_pair", itemIds: ["t2", "s2"] })];
    let together = 0;
    let runs = 0;
    for (let seed = 0; seed < 150; seed += 1) {
      for (const proposal of buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), rules })) {
        runs += 1;
        if (proposal.itemIds.includes("t2") && proposal.itemIds.includes("s2")) together += 1;
      }
    }
    expect(together).toBeGreaterThan(0);
    expect(together).toBeLessThan(runs); // soft, not a requirement
  });
});
