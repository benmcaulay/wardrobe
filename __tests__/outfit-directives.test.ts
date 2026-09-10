import { describe, it, expect } from "vitest";
import {
  DIRECTIVE_BOOST,
  clampFormality,
  describeDirective,
  directiveBonus,
  itemSatisfies,
  diagnoseDirective,
  parseDirectiveKeywords,
  unmetDirectives,
  type SessionDirective,
} from "../lib/outfit/directives";
import { PREFER_BOOST } from "../lib/outfit/style-rules";

const VOCAB = {
  categories: ["hat", "shirt", "t shirt", "long sleeve shirt", "jeans", "shoes", "jacket"],
  colors: ["red", "black", "white", "navy"],
};

const item = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  category: "hat",
  colors: [{ hex: "#f00", name: "red" }],
  ...over,
}) as any;

const redHat: SessionDirective = { kind: "include", id: "d", text: "red hat", category: "hat", terms: ["red"] };

describe("parseDirectiveKeywords", () => {
  it("reads a colour and a category out of plain English", () => {
    expect(parseDirectiveKeywords("I want a red hat", VOCAB)).toMatchObject({
      kind: "include", category: "hat", terms: ["red"],
    });
  });

  it("prefers the longest matching category", () => {
    // "long sleeve shirt" contains "shirt"; the specific label must win.
    expect(parseDirectiveKeywords("a navy long sleeve shirt", VOCAB)).toMatchObject({
      category: "long sleeve shirt",
    });
  });

  it("matches a plural category", () => {
    expect(parseDirectiveKeywords("wear jeans", VOCAB)).toMatchObject({ category: "jeans" });
  });

  it("maps formality words onto the ladder", () => {
    expect(parseDirectiveKeywords("keep it formal", VOCAB)).toMatchObject({ kind: "formality", target: 9 });
    expect(parseDirectiveKeywords("something casual", VOCAB)).toMatchObject({ kind: "formality", target: 3 });
    expect(parseDirectiveKeywords("gym", VOCAB)).toMatchObject({ kind: "formality", target: 1 });
  });

  it("returns null when nothing is recognisable, rather than guessing", () => {
    // The signal to ask the model. A wrong guess reshapes every outfit
    // silently, so silence is the safer failure.
    expect(parseDirectiveKeywords("something a bit more me", VOCAB)).toBeNull();
    expect(parseDirectiveKeywords("   ", VOCAB)).toBeNull();
  });

  it("accepts a colour with no category", () => {
    expect(parseDirectiveKeywords("more black", VOCAB)).toMatchObject({ terms: ["black"], category: undefined });
  });
});

describe("itemSatisfies", () => {
  it("matches on category and colour together", () => {
    expect(itemSatisfies(item(), redHat)).toBe(true);
  });

  it("rejects the right colour in the wrong category", () => {
    expect(itemSatisfies(item({ category: "shirt" }), redHat)).toBe(false);
  });

  it("rejects the right category in the wrong colour", () => {
    expect(itemSatisfies(item({ colors: [{ hex: "#000", name: "black" }] }), redHat)).toBe(false);
  });

  it("matches a subcategory, so 'shirt' covers 't shirt'", () => {
    const d: SessionDirective = { kind: "include", id: "d", text: "shirt", category: "shirt", terms: [] };
    expect(itemSatisfies(item({ category: "t shirt", subcategory: "shirt" }), d)).toBe(true);
  });

  it("falls back to material, pattern and name for a bare term", () => {
    const linen: SessionDirective = { kind: "include", id: "d", text: "linen", terms: ["linen"] };
    expect(itemSatisfies(item({ material: "linen", colors: [] }), linen)).toBe(true);
    const striped: SessionDirective = { kind: "include", id: "d", text: "striped", terms: ["striped"] };
    expect(itemSatisfies(item({ pattern: "striped", colors: [] }), striped)).toBe(true);
  });
});

describe("directiveBonus", () => {
  it("outranks a standing preference decisively", () => {
    expect(directiveBonus([], item(), [redHat])).toBeGreaterThan(PREFER_BOOST * 4);
    expect(directiveBonus([], item(), [redHat])).toBe(DIRECTIVE_BOOST);
  });

  it("pays out once, so one directive cannot crowd out the outfit", () => {
    const placed = [item({ id: "already" })];
    expect(directiveBonus(placed, item({ id: "second" }), [redHat])).toBe(0);
  });

  it("gives nothing to a garment that does not match", () => {
    expect(directiveBonus([], item({ category: "shoes", colors: [] }), [redHat])).toBe(0);
  });

  it("penalises formality distance rather than excluding", () => {
    const formal: SessionDirective = { kind: "formality", id: "d", text: "formal", target: 9 };
    const casual = directiveBonus([], item({ category: "shorts", name: "gym shorts" }), [formal]);
    const dressy = directiveBonus([], item({ category: "dress shirt", name: "oxford" }), [formal]);
    expect(dressy).toBeGreaterThan(casual);
    // Soft: even a bad match is a finite penalty, never a rejection.
    expect(Number.isFinite(casual)).toBe(true);
  });
});

describe("unmetDirectives", () => {
  it("reports an include nothing satisfied", () => {
    const got = unmetDirectives([item({ category: "shoes", colors: [] })], [redHat]);
    expect(got).toHaveLength(1);
  });

  it("stays quiet when the outfit honours it", () => {
    expect(unmetDirectives([item()], [redHat])).toHaveLength(0);
  });

  it("judges formality on the whole look, not one garment", () => {
    // A formal outfit is allowed a casual belt.
    const formal: SessionDirective = { kind: "formality", id: "d", text: "formal", target: 9 };
    const dressy = [
      item({ category: "dress shirt", name: "oxford shirt" }),
      item({ category: "shoes", name: "leather dress shoes" }),
    ];
    expect(unmetDirectives(dressy, [formal]).length).toBeLessThanOrEqual(1);
    expect(unmetDirectives([], [formal])).toHaveLength(1);
  });
});

describe("clampFormality", () => {
  it("holds the ladder's bounds and survives nonsense", () => {
    expect(clampFormality(99)).toBe(10);
    expect(clampFormality(-4)).toBe(0);
    expect(clampFormality(Number.NaN)).toBe(5);
  });
});

describe("describeDirective", () => {
  it("restates the effect in words", () => {
    expect(describeDirective(redHat)).toBe("Including red hat");
    expect(describeDirective({ kind: "formality", id: "d", text: "x", target: 9 })).toBe("Dressing formally");
  });
});

describe("category nesting", () => {
  it("accepts a t shirt for a directive asking for a shirt", () => {
    // The slot rules already widen an item to its ancestors; the matcher has
    // to agree, or "a red shirt" silently excludes every t shirt.
    const d: SessionDirective = { kind: "include", id: "d", text: "red shirt", category: "shirt", terms: ["red"] };
    const tee = item({ category: "t shirt", categoryPath: ["t shirt", "shirt", "top"] });
    expect(itemSatisfies(tee, d)).toBe(true);
  });

  it("still rejects an unrelated category with the right colour", () => {
    const d: SessionDirective = { kind: "include", id: "d", text: "red shirt", category: "shirt", terms: ["red"] };
    const shoes = item({ category: "shoes", categoryPath: ["shoes", "footwear"] });
    expect(itemSatisfies(shoes, d)).toBe(false);
  });
});

describe("diagnoseDirective", () => {
  const d: SessionDirective = { kind: "include", id: "d", text: "red hat", category: "hat", terms: ["red"] };
  const redHat = item({ id: "h", category: "hat" });
  const blackShirt = item({ id: "s", category: "shirt", colors: [{ hex: "#000", name: "black" }] });

  it("says no_match only when the closet really lacks it", () => {
    expect(diagnoseDirective(d, [blackShirt], () => true)).toBe("no_match");
  });

  it("says no_slot when the garment exists but nothing can seat it", () => {
    // The bug this exists to prevent: a closet with five red hats and a
    // layout with no hat slot was told "nothing in your closet matches".
    expect(diagnoseDirective(d, [redHat, blackShirt], () => false)).toBe("no_slot");
  });

  it("says not_this_time when it was seatable and simply was not drawn", () => {
    expect(diagnoseDirective(d, [redHat], () => true)).toBe("not_this_time");
  });
});

describe("wider vocabulary", () => {
  it("reads a negation as an avoidance, not a request", () => {
    // "no black" and "black" share every term and differ only in the
    // negation; reading it second would turn every avoidance into a request.
    expect(parseDirectiveKeywords("no black", VOCAB)).toMatchObject({
      kind: "exclude", terms: ["black"],
    });
    expect(parseDirectiveKeywords("without a jacket", VOCAB)).toMatchObject({
      kind: "exclude", category: "jacket",
    });
    expect(parseDirectiveKeywords("black", VOCAB)).toMatchObject({ kind: "include" });
  });

  it("does not read a negated vibe as that vibe", () => {
    expect(parseDirectiveKeywords("nothing formal", VOCAB)?.kind).not.toBe("formality");
  });

  it("maps weather words onto the warmth scale", () => {
    expect(parseDirectiveKeywords("it's freezing", VOCAB)).toMatchObject({ kind: "warmth", target: 3 });
    expect(parseDirectiveKeywords("something light", VOCAB)).toMatchObject({ kind: "warmth", target: 0.5 });
  });

  it("penalises an excluded garment as hard as it rewards a wanted one", () => {
    const avoid: SessionDirective = { kind: "exclude", id: "d", text: "no red", terms: ["red"] };
    expect(directiveBonus([], item(), [avoid])).toBe(-DIRECTIVE_BOOST);
  });

  it("keeps an exclusion soft, so a slot with nothing else can still fill", () => {
    const avoid: SessionDirective = { kind: "exclude", id: "d", text: "no red", terms: ["red"] };
    expect(Number.isFinite(directiveBonus([], item(), [avoid]))).toBe(true);
  });

  it("reports an exclusion that slipped through", () => {
    const avoid: SessionDirective = { kind: "exclude", id: "d", text: "no red", terms: ["red"] };
    expect(unmetDirectives([item()], [avoid])).toHaveLength(1);
    expect(unmetDirectives([item({ colors: [{ hex: "#000", name: "black" }] })], [avoid])).toHaveLength(0);
  });

  it("blames the bench, not the closet, when an exclusion fails", () => {
    const avoid: SessionDirective = { kind: "exclude", id: "d", text: "no red", terms: ["red"] };
    expect(diagnoseDirective(avoid, [item()], () => true)).toBe("couldnt_avoid");
  });

  it("treats a note as heard but inert", () => {
    const note: SessionDirective = { kind: "note", id: "d", text: "something more me" };
    expect(directiveBonus([], item(), [note])).toBe(0);
    expect(unmetDirectives([item()], [note])).toHaveLength(0);
    expect(describeDirective(note)).toMatch(/not something I can match/i);
  });
});

describe("colour sets and the all quantifier", () => {
  const GREY = { categories: VOCAB.categories, colors: ["red", "black", "gray", "white", "navy", "beige"] };

  it("reads 'all greyscale' as every piece, from a set of colours", () => {
    // The reported bug: this parsed to include[black,gray,white] with AND
    // semantics, needing one garment that was all three at once, so it did
    // nothing at all.
    const d = parseDirectiveKeywords("all greyscale", GREY);
    expect(d).toMatchObject({ kind: "include", all: true });
    expect((d as any).terms).toEqual(expect.arrayContaining(["black", "gray", "white"]));
  });

  it("matches a garment holding any one of the colours", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    expect(itemSatisfies(item({ colors: [{ hex: "#000", name: "black" }] }), d)).toBe(true);
    expect(itemSatisfies(item({ colors: [{ hex: "#fff", name: "white" }] }), d)).toBe(true);
    expect(itemSatisfies(item({ colors: [{ hex: "#f00", name: "red" }] }), d)).toBe(false);
  });

  it("rewards every matching piece and penalises the ones that break it", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    const grey = item({ colors: [{ hex: "#888", name: "gray" }] });
    const red = item({ colors: [{ hex: "#f00", name: "red" }] });
    // A seated grey piece must not satisfy it for the rest of the outfit.
    expect(directiveBonus([grey], grey, [d])).toBeGreaterThan(0);
    expect(directiveBonus([grey], red, [d])).toBeLessThan(0);
  });

  it("is unmet unless the whole look complies", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    const grey = item({ colors: [{ hex: "#888", name: "gray" }] });
    const red = item({ colors: [{ hex: "#f00", name: "red" }] });
    expect(unmetDirectives([grey, grey], [d])).toHaveLength(0);
    expect(unmetDirectives([grey, red], [d])).toHaveLength(1);
  });

  it("keeps a single-piece ask singular", () => {
    // "a red hat" must not become "every piece red".
    const d = parseDirectiveKeywords("I want a red hat", VOCAB)!;
    expect((d as any).all).toBeFalsy();
  });

  it("reads a negated colour set as an avoidance", () => {
    expect(parseDirectiveKeywords("no neutrals", GREY)).toMatchObject({ kind: "exclude" });
  });

  it("says 'Everything' rather than 'Including' for an all directive", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    expect(describeDirective(d)).toMatch(/^Everything /);
  });
});

describe("primary colour for whole-outfit palettes", () => {
  const GREY = { categories: VOCAB.categories, colors: ["red", "black", "gray", "white", "navy", "beige", "blue"] };
  // Real rows from the closet that exposed this.
  const redJacket = item({ category: "jacket", colors: [
    { hex: "#c0392b", name: "red" }, { hex: "#111", name: "black" }, { hex: "#fff", name: "white" }] });
  const blueJeans = item({ category: "jeans", colors: [
    { hex: "#4a6fb0", name: "blue" }, { hex: "#111", name: "black" }] });
  const whiteShirt = item({ category: "shirt", colors: [
    { hex: "#fff", name: "white" }, { hex: "#c0392b", name: "red" }] });

  it("rejects a garment that is only incidentally greyscale", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    expect(itemSatisfies(redJacket, d)).toBe(false);
    expect(itemSatisfies(blueJeans, d)).toBe(false);
  });

  it("accepts one whose primary colour qualifies", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    expect(itemSatisfies(whiteShirt, d)).toBe(true);
  });

  it("stays forgiving for a singular ask", () => {
    // "a red hat" should take a hat with red in it, not only a wholly red one.
    const d: SessionDirective = { kind: "include", id: "d", text: "red", terms: ["red"] };
    expect(itemSatisfies(whiteShirt, d)).toBe(true);
  });

  it("avoids a colour wherever it appears", () => {
    const d: SessionDirective = { kind: "exclude", id: "d", text: "no red", terms: ["red"] };
    expect(itemSatisfies(redJacket, d)).toBe(true);
  });

  it("does not treat beige as greyscale, but does treat it as neutral", () => {
    const tan = item({ colors: [{ hex: "#d4b896", name: "beige" }] });
    expect(itemSatisfies(tan, parseDirectiveKeywords("all greyscale", GREY)!)).toBe(false);
    expect(itemSatisfies(tan, parseDirectiveKeywords("all neutrals", GREY)!)).toBe(true);
  });
});

describe("names are not evidence of a palette", () => {
  const GREY = { categories: VOCAB.categories, colors: ["red", "black", "gray", "white", "navy", "blue"] };
  // A real row: primary blue, and the word "Gray" in its name.
  const blueGreyTee = item({
    category: "t shirt",
    name: "Blue Gray T",
    colors: [{ hex: "#4a6fb0", name: "blue" }, { hex: "#888", name: "gray" }],
  });

  it("rejects a blue garment whose name mentions grey", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    expect(itemSatisfies(blueGreyTee, d)).toBe(false);
  });

  it("reports the outfit as non-compliant because of it", () => {
    const d = parseDirectiveKeywords("all greyscale", GREY)!;
    const black = item({ colors: [{ hex: "#111", name: "black" }] });
    expect(unmetDirectives([black, blueGreyTee], [d])).toHaveLength(1);
  });

  it("still lets a singular ask find things by name", () => {
    // "the puffer" has no colour, material or category to go on.
    const d: SessionDirective = { kind: "exclude", id: "d", text: "not the puffer", terms: ["puffer"] };
    expect(itemSatisfies(item({ name: "Nike Puffer Jacket", colors: [] }), d)).toBe(true);
  });

  it("keeps material working for a whole-outfit ask", () => {
    const d: SessionDirective = { kind: "include", id: "d", text: "all linen", terms: ["linen"], all: true };
    expect(itemSatisfies(item({ material: "linen", colors: [] }), d)).toBe(true);
  });
});

describe("palette cardinality", () => {
  const GREY = { categories: VOCAB.categories, colors: ["red", "black", "gray", "white", "navy", "blue"] };
  const of = (name: string) => item({ colors: [{ hex: "#000", name }] });

  it("reads a colour count, which no other primitive could express", () => {
    // The reported failure: "2 colors in color pallete" returned a note,
    // because a cardinality limit is not a colour name.
    expect(parseDirectiveKeywords("2 colors in color pallete", GREY)).toMatchObject({
      kind: "palette", maxColors: 2,
    });
    expect(parseDirectiveKeywords("two colours max", GREY)).toMatchObject({ maxColors: 2 });
    expect(parseDirectiveKeywords("monochrome", GREY)).toMatchObject({ maxColors: 1 });
  });

  it("does not mistake a colour name for a count", () => {
    expect(parseDirectiveKeywords("all greyscale", GREY)?.kind).toBe("include");
  });

  it("is free until the budget is spent, then charges for a new colour", () => {
    const d: SessionDirective = { kind: "palette", id: "d", text: "2 colours", maxColors: 2 };
    const black = of("black"), white = of("white"), red = of("red");
    expect(directiveBonus([], black, [d])).toBe(0);
    expect(directiveBonus([black], white, [d])).toBe(0);
    // A colour already in the look is always free, however full the budget.
    expect(directiveBonus([black, white], black, [d])).toBe(0);
    expect(directiveBonus([black, white], red, [d])).toBeLessThan(0);
  });

  it("counts distinct primary colours, not garments", () => {
    const d: SessionDirective = { kind: "palette", id: "d", text: "2 colours", maxColors: 2 };
    const look = [of("black"), of("black"), of("white")];
    expect(unmetDirectives(look, [d])).toHaveLength(0);
    expect(unmetDirectives([...look, of("red")], [d])).toHaveLength(1);
  });

  it("ignores an item with no recorded colour rather than counting it", () => {
    const d: SessionDirective = { kind: "palette", id: "d", text: "1 colour", maxColors: 1 };
    expect(unmetDirectives([of("black"), item({ colors: [] })], [d])).toHaveLength(0);
  });

  it("says what it is doing", () => {
    expect(describeDirective({ kind: "palette", id: "d", text: "x", maxColors: 2 })).toBe("At most 2 colours");
    expect(describeDirective({ kind: "palette", id: "d", text: "x", maxColors: 1 })).toBe("At most 1 colour");
  });
});

describe("brand", () => {
  const B = { categories: VOCAB.categories, colors: ["red", "black", "white"] };

  it("matches a brand name as a term", () => {
    // 81 of 111 items carry a brand across 52 labels, so this has something
    // to bite on — unlike season (1 of 111) or wear history (0 events).
    const d: SessionDirective = { kind: "include", id: "d", text: "nike", terms: ["nike"] };
    expect(itemSatisfies(item({ brand: "Nike", colors: [] }), d)).toBe(true);
    expect(itemSatisfies(item({ brand: "Adidas", colors: [] }), d)).toBe(false);
  });

  it("counts brand even for a whole-outfit ask", () => {
    // "all Nike" is a real request; brand is structured, unlike a garment's
    // name, so it is safe where the name fallback was not.
    const d: SessionDirective = { kind: "include", id: "d", text: "all nike", terms: ["nike"], all: true };
    expect(itemSatisfies(item({ brand: "Nike", colors: [{ hex: "#f00", name: "red" }] }), d)).toBe(true);
  });

  it("avoids a brand", () => {
    const d: SessionDirective = { kind: "exclude", id: "d", text: "no nike", terms: ["nike"] };
    expect(itemSatisfies(item({ brand: "Nike", colors: [] }), d)).toBe(true);
  });
});

describe("naming actual garments", () => {
  const d: SessionDirective = {
    kind: "items", id: "d", text: "beach day",
    itemIds: ["a", "b"], labels: ["Havaianas", "Bucket hat"],
  };

  it("boosts every named garment, not just the first", () => {
    // A chosen set is meant to arrive together; a once-only payout would
    // seat one and leave the rest to chance.
    expect(directiveBonus([item({ id: "a" })], item({ id: "b" }), [d])).toBe(DIRECTIVE_BOOST);
    expect(directiveBonus([], item({ id: "a" }), [d])).toBe(DIRECTIVE_BOOST);
  });

  it("ignores garments it did not name", () => {
    expect(directiveBonus([], item({ id: "zzz" }), [d])).toBe(0);
  });

  it("is met when any of them lands", () => {
    // The set usually spans more categories than the layout has slots, so
    // demanding all of them would report failure on a compliant look.
    expect(unmetDirectives([item({ id: "a" })], [d])).toHaveLength(0);
    expect(unmetDirectives([item({ id: "zzz" })], [d])).toHaveLength(1);
  });

  it("names what it picked, and counts the overflow", () => {
    expect(describeDirective(d)).toBe("Picking Havaianas, Bucket hat");
    const many: SessionDirective = { ...d, labels: ["A", "B", "C", "D", "E"] };
    expect(describeDirective(many)).toBe("Picking A, B, C +2 more");
  });
});
