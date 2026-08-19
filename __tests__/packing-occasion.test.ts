import { describe, expect, it } from "vitest";
import {
  deriveOccasion,
  isDailyWear,
  isOccasionPiece,
  occasionLabel,
  partitionByDailyWear,
} from "@/lib/packing/occasion";

const item = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  category: "shorts",
  subcategory: null,
  ...extra,
});

describe("deriveOccasion", () => {
  /** The two real garments in the closet that started this. */
  it("spots the actual swimwear in the wardrobe", () => {
    expect(deriveOccasion(item("One Piece Trunks"))).toBe("swim");
    expect(deriveOccasion(item('Red 18" Board Shorts'))).toBe("swim");
  });

  it("spots swimwear by its other names", () => {
    for (const name of ["Swim Shorts", "Speedo", "Bikini Top", "Rash Guard", "Wetsuit", "Swimsuit"]) {
      expect(deriveOccasion(item(name)), name).toBe("swim");
    }
  });

  it("spots sleepwear", () => {
    for (const name of ["Flannel Pyjamas", "Pajama Pants", "Dressing Gown", "Nightgown"]) {
      expect(deriveOccasion(item(name)), name).toBe("sleep");
    }
  });

  it("spots black-tie pieces", () => {
    for (const name of ["Tuxedo Jacket", "Black Tux", "Bow Tie", "Ball Gown"]) {
      expect(deriveOccasion(item(name)), name).toBe("formal");
    }
  });

  /**
   * A false positive silently removes a wearable garment from the rotation,
   * which is worse than leaving one in. These are the near-misses that would
   * do real damage.
   */
  it("leaves ordinary clothes alone", () => {
    for (const name of [
      "Lululemon Shorts",
      "Momotaro Black Denim",
      "Billabong Fuzzy Sweater",
      "Timberland Gray Brown Boots",
      "Chargers Dark AFC Tee",
      "Tan Cap",
    ]) {
      expect(deriveOccasion(item(name)), name).toBeNull();
    }
  });

  /** "suit" as a bare token would catch all of these, so it isn't one. */
  it("does not mistake a tracksuit or a suit jacket for occasion wear", () => {
    for (const name of ["Adidas Tracksuit Bottoms", "Grey Suit Jacket", "Boilersuit", "Wetsuit Wax"]) {
      const kind = deriveOccasion(item(name));
      // Only the genuine wetsuit-adjacent one may match, and only as swim.
      expect(kind === null || kind === "swim", `${name} -> ${kind}`).toBe(true);
    }
    expect(deriveOccasion(item("Adidas Tracksuit Bottoms"))).toBeNull();
    expect(deriveOccasion(item("Grey Suit Jacket"))).toBeNull();
  });

  /** Athletic kit is deliberately left in the rotation; see the module header. */
  it("leaves athletic clothing in the daily rotation", () => {
    for (const name of ["Nike Running Shorts", "Gym Tee", "Compression Leggings"]) {
      expect(deriveOccasion(item(name)), name).toBeNull();
    }
  });

  it("reads the subcategory and category too, not just the name", () => {
    expect(deriveOccasion({ name: "Blue", subcategory: "swim trunks", category: "shorts" })).toBe("swim");
    expect(deriveOccasion({ name: "Blue", subcategory: null, category: "swimwear" })).toBe("swim");
  });

  it("survives missing fields", () => {
    expect(deriveOccasion({})).toBeNull();
    expect(deriveOccasion({ name: null, subcategory: null, category: null })).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(deriveOccasion(item("BOARD SHORTS"))).toBe("swim");
  });
});

describe("isDailyWear", () => {
  it("keeps ordinary clothes and drops occasion pieces", () => {
    expect(isDailyWear(item("Lululemon Shorts"))).toBe(true);
    expect(isDailyWear(item("One Piece Trunks"))).toBe(false);
    expect(isOccasionPiece(item("One Piece Trunks"))).toBe(true);
  });

  /** The override is the escape hatch for whatever the patterns get wrong. */
  it("lets the override force a piece back into the rotation", () => {
    expect(isDailyWear(item("Board Shorts", { dailyWear: true }))).toBe(true);
  });

  it("lets the override force an ordinary piece out", () => {
    expect(isDailyWear(item("Lululemon Shorts", { dailyWear: false }))).toBe(false);
  });

  it("falls back to the guess when the override is unset", () => {
    expect(isDailyWear(item("One Piece Trunks", { dailyWear: null }))).toBe(false);
    expect(isDailyWear(item("One Piece Trunks", { dailyWear: undefined }))).toBe(false);
  });

  /** The override must not change what the *guess* would have been. */
  it("leaves the derived kind visible behind an override", () => {
    expect(deriveOccasion(item("Board Shorts", { dailyWear: true }))).toBe("swim");
  });
});

describe("partitionByDailyWear", () => {
  it("splits a list in one pass", () => {
    const { daily, occasion } = partitionByDailyWear([
      item("Lululemon Shorts"),
      item("One Piece Trunks"),
      item("Momotaro Black Denim"),
      item('Red 18" Board Shorts'),
    ]);
    expect(daily.map((i) => i.name)).toEqual(["Lululemon Shorts", "Momotaro Black Denim"]);
    expect(occasion.map((i) => i.name)).toEqual(["One Piece Trunks", 'Red 18" Board Shorts']);
  });

  it("handles an empty list", () => {
    expect(partitionByDailyWear([])).toEqual({ daily: [], occasion: [] });
  });

  it("preserves order within each side", () => {
    const { daily } = partitionByDailyWear([item("A"), item("Trunks"), item("B")]);
    expect(daily.map((i) => i.name)).toEqual(["A", "B"]);
  });
});

describe("occasionLabel", () => {
  it("names every kind", () => {
    expect(occasionLabel("swim")).toBe("Swimwear");
    expect(occasionLabel("sleep")).toBe("Sleepwear");
    expect(occasionLabel("formal")).toBe("Formalwear");
  });
});
