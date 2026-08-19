import { describe, expect, it } from "vitest";
import {
  GEAR_CATEGORIES,
  GEAR_PRESETS,
  gearCategoryLabel,
  gearFootprint,
  gearIconName,
  isGearCategory,
  parseGearCategory,
  suggestGear,
  type GearCategory,
} from "@/lib/packing/gear";
import { ICON_REGISTRY } from "@/components/icons";

const ICON_NAMES = new Set(ICON_REGISTRY.map((entry) => entry.name));

describe("categories", () => {
  it("recognises its own ids and rejects anything else", () => {
    for (const category of GEAR_CATEGORIES) expect(isGearCategory(category.id)).toBe(true);
    expect(isGearCategory("weapons")).toBe(false);
    expect(isGearCategory("")).toBe(false);
  });

  it("coerces junk from the database to a real category", () => {
    expect(parseGearCategory("tech")).toBe("tech");
    expect(parseGearCategory("nonsense")).toBe("misc");
    expect(parseGearCategory(null)).toBe("misc");
    expect(parseGearCategory(undefined)).toBe("misc");
  });

  it("labels every category", () => {
    for (const category of GEAR_CATEGORIES) {
      expect(gearCategoryLabel(category.id)).toBe(category.label);
    }
  });

  /**
   * A category whose icon isn't in the suite renders as the fallback pouch,
   * which looks like a bug rather than a missing icon. Cheap to catch here.
   */
  it("only names icons that actually exist", () => {
    for (const category of GEAR_CATEGORIES) {
      expect(ICON_NAMES.has(category.icon), `missing icon ${category.icon}`).toBe(true);
    }
    for (const preset of GEAR_PRESETS) {
      if (!preset.icon) continue;
      expect(ICON_NAMES.has(preset.icon), `missing icon ${preset.icon}`).toBe(true);
    }
  });
});

describe("gearIconName", () => {
  it("prefers the item's own icon", () => {
    expect(gearIconName({ category: "tech", icon: "laptop" })).toBe("laptop");
  });

  it("falls back to the category's icon", () => {
    expect(gearIconName({ category: "documents", icon: null })).toBe("passport");
    expect(gearIconName({ category: "documents", icon: "" })).toBe("passport");
  });
});

describe("gearFootprint", () => {
  const base = { category: "tech" as GearCategory, quantity: 1, weightGrams: 100, volumeLiters: 0.5 };

  it("uses the measured numbers when both are present", () => {
    expect(gearFootprint(base)).toEqual({ weightGrams: 100, volumeLiters: 0.5, estimated: false });
  });

  it("multiplies by quantity", () => {
    const three = gearFootprint({ ...base, quantity: 3 });
    expect(three.weightGrams).toBe(300);
    expect(three.volumeLiters).toBe(1.5);
  });

  /**
   * The whole reason weight and volume are nullable: an unmeasured charger
   * must not read as weighing nothing, or a bag meter silently under-reports.
   */
  it("substitutes the category estimate rather than zero", () => {
    const unmeasured = gearFootprint({ ...base, weightGrams: null, volumeLiters: null });
    expect(unmeasured.weightGrams).toBe(250);
    expect(unmeasured.volumeLiters).toBe(0.6);
    expect(unmeasured.estimated).toBe(true);
  });

  it("flags a row as estimated when only one number is missing", () => {
    expect(gearFootprint({ ...base, weightGrams: null }).estimated).toBe(true);
    expect(gearFootprint({ ...base, volumeLiters: null }).estimated).toBe(true);
  });

  it("keeps a real zero as zero", () => {
    const weightless = gearFootprint({ ...base, weightGrams: 0 });
    expect(weightless.weightGrams).toBe(0);
    expect(weightless.estimated).toBe(false);
  });

  it("treats a nonsense quantity as one", () => {
    expect(gearFootprint({ ...base, quantity: 0 }).weightGrams).toBe(100);
    expect(gearFootprint({ ...base, quantity: -4 }).weightGrams).toBe(100);
    expect(gearFootprint({ ...base, quantity: NaN }).weightGrams).toBe(100);
  });

  it("estimates every category without throwing", () => {
    for (const category of GEAR_CATEGORIES) {
      const footprint = gearFootprint({
        category: category.id,
        quantity: 1,
        weightGrams: null,
        volumeLiters: null,
      });
      expect(footprint.weightGrams).toBeGreaterThan(0);
      expect(footprint.volumeLiters).toBeGreaterThan(0);
    }
  });
});

describe("suggestGear", () => {
  const library = [
    { id: "u", name: "Umbrella", category: "comfort" as GearCategory, packed: false },
    { id: "p", name: "Passport", category: "documents" as GearCategory, packed: false },
    { id: "w", name: "Wash bag", category: "toiletries" as GearCategory, packed: false },
    { id: "c", name: "Phone charger", category: "tech" as GearCategory, packed: false },
  ];

  it("suggests an umbrella when rain is likely", () => {
    const out = suggestGear({ library, rainChance: 0.6, band: "mild", days: 3 });
    const umbrella = out.find((s) => s.id === "u");
    expect(umbrella).toBeTruthy();
    expect(umbrella!.reason).toContain("60%");
  });

  it("stays quiet about rain when it's unlikely", () => {
    const out = suggestGear({ library, rainChance: 0.05, band: "warm", days: 2 });
    expect(out.find((s) => s.id === "u")).toBeUndefined();
  });

  it("never suggests something already in a bag", () => {
    const packed = library.map((g) => ({ ...g, packed: true }));
    expect(suggestGear({ library: packed, rainChance: 0.9, band: "cold", days: 9 })).toEqual([]);
  });

  it("flags documents you haven't packed", () => {
    const out = suggestGear({ library, rainChance: null, band: null, days: 2 });
    expect(out.map((s) => s.id)).toContain("p");
  });

  it("suggests a wash bag on a long trip", () => {
    const out = suggestGear({ library, rainChance: null, band: null, days: 7 });
    expect(out.map((s) => s.id)).toContain("w");
  });

  it("never returns more than four, or the same thing twice", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      name: `Document ${i}`,
      category: "documents" as GearCategory,
      packed: false,
    }));
    const out = suggestGear({ library: [...library, ...many], rainChance: 0.8, band: "cold", days: 10 });
    expect(out.length).toBeLessThanOrEqual(4);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it("handles an empty library", () => {
    expect(suggestGear({ library: [], rainChance: 0.9, band: "cold", days: 10 })).toEqual([]);
  });
});
