import { describe, it, expect } from "vitest";
import { outfitRegion, spreadOverlappingSlots } from "../lib/outfit-slot-defaults";

type Slot = { id: string; categories: string[]; x: number; y: number };
const slot = (id: string, cat: string, x = 280, y = 300): Slot => ({ id, categories: [cat], x, y });

describe("outfitRegion", () => {
  it("groups tops (shirt/jacket/sweater/hoodie) together", () => {
    expect(outfitRegion(["shirt"])).toBe("top");
    expect(outfitRegion(["jacket"])).toBe("top");
    expect(outfitRegion(["Sweater/Hoodie"])).toBe("top");
  });
  it("groups bottoms (pants/shorts) together", () => {
    expect(outfitRegion(["pants"])).toBe("bottom");
    expect(outfitRegion(["shorts"])).toBe("bottom");
  });
  it("separates head, feet, dress, other", () => {
    expect(outfitRegion(["hat"])).toBe("head");
    expect(outfitRegion(["shoes"])).toBe("feet");
    expect(outfitRegion(["dress"])).toBe("dress");
    expect(outfitRegion(["accessory"])).toBe("other");
  });
});

describe("spreadOverlappingSlots", () => {
  it("offsets same-region pieces to distinct x positions", () => {
    const out = spreadOverlappingSlots([
      slot("a", "shirt"),
      slot("b", "jacket"),
      slot("c", "sweater/hoodie"),
    ]);
    const xs = out.map((s) => s.x);
    expect(new Set(xs).size).toBe(3); // all different
    expect(xs).toEqual([...xs].sort((a, b) => a - b)); // left→right in order
  });

  it("also spreads duplicate categories (e.g. two hats)", () => {
    const out = spreadOverlappingSlots([slot("a", "hat"), slot("b", "hat")]);
    expect(out[0]!.x).not.toBe(out[1]!.x);
  });

  it("leaves a single piece per region centered/untouched", () => {
    const input = [slot("a", "shirt", 280, 300), slot("b", "pants", 280, 400)];
    const out = spreadOverlappingSlots(input);
    expect(out[0]!.x).toBe(280);
    expect(out[1]!.x).toBe(280);
  });

  it("does not spread unrelated 'other' items", () => {
    const out = spreadOverlappingSlots([slot("a", "accessory"), slot("b", "accessory")]);
    expect(out[0]!.x).toBe(280);
    expect(out[1]!.x).toBe(280);
  });

  it("keeps spread pieces within the frame bounds", () => {
    const many = ["shirt", "jacket", "sweater", "hoodie", "top"].map((c, i) => slot(String(i), c));
    const out = spreadOverlappingSlots(many);
    for (const s of out) {
      expect(s.x).toBeGreaterThanOrEqual(90);
      expect(s.x).toBeLessThanOrEqual(560 - 90);
    }
  });
});
