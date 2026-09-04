import { describe, expect, it } from "vitest";
import {
  EMPTY_LOOK_PREFS,
  LOOK_FRAME_HEIGHT,
  LOOK_FRAME_WIDTH,
  composeLook,
  lookBounds,
  type LookLayoutPrefs,
} from "@/lib/packing/look";
import { outfitSlotDefaultKey } from "@/lib/outfit-slot-defaults";

const piece = (id: string, category: string) => ({ id, category });

const prefsWith = (over: Partial<LookLayoutPrefs>): LookLayoutPrefs => ({
  ...EMPTY_LOOK_PREFS,
  ...over,
});

describe("composeLook", () => {
  it("places nothing for an empty look", () => {
    expect(composeLook([])).toEqual([]);
  });

  it("returns one placement per piece", () => {
    const placed = composeLook([piece("a", "shirt"), piece("b", "pants"), piece("c", "shoes")]);
    expect(placed).toHaveLength(3);
    expect(placed.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  /**
   * The built-in placement is what makes a look read as a body rather than a
   * pile: hats high, shoes low, everything else between.
   */
  it("stacks the body top to bottom", () => {
    const placed = composeLook([
      piece("hat", "hat"),
      piece("top", "shirt"),
      piece("bottom", "pants"),
      piece("feet", "shoes"),
    ]);
    const y = Object.fromEntries(placed.map((p) => [p.id, p.y]));
    expect(y.hat).toBeLessThan(y.top);
    expect(y.top).toBeLessThan(y.bottom);
    expect(y.bottom).toBeLessThan(y.feet);
  });

  it("keeps everything inside the frame", () => {
    const placed = composeLook([
      piece("a", "hat"),
      piece("b", "shirt"),
      piece("c", "jacket"),
      piece("d", "pants"),
      piece("e", "shoes"),
    ]);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(LOOK_FRAME_WIDTH);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(LOOK_FRAME_HEIGHT);
    }
  });

  it("gives every piece a distinct stacking order", () => {
    const placed = composeLook([piece("a", "shirt"), piece("b", "jacket"), piece("c", "pants")]);
    expect(new Set(placed.map((p) => p.z)).size).toBe(placed.length);
  });

  /** Jackets and trousers are big garments; the builder renders them double. */
  it("applies the built-in per-category size", () => {
    const placed = composeLook([piece("j", "jacket"), piece("t", "tee")]);
    const scale = Object.fromEntries(placed.map((p) => [p.id, p.scale]));
    expect(scale.j).toBe(2);
    expect(scale.t).toBe(1);
  });

  it("honours a saved slot default over the built-in placement", () => {
    const key = outfitSlotDefaultKey(["shirt"]);
    const placed = composeLook(
      [piece("a", "shirt")],
      prefsWith({ slotDefaults: { [key]: { x: 100, y: 200, scale: 1 } } }),
    );
    expect(placed[0].x).toBe(100);
    expect(placed[0].y).toBe(200);
  });

  it("separates two pieces of the same category instead of stacking them", () => {
    const placed = composeLook([piece("a", "shirt"), piece("b", "shirt")]);
    expect(placed[0].x).not.toBe(placed[1].x);
  });

  /**
   * A piece the user dragged somewhere has a saved x *and* y, and must be left
   * exactly there — the auto-spread is only for pieces it hasn't placed.
   */
  it("pins a hand-placed piece and leaves it out of the spread", () => {
    const layers = [["shirt", "jacket"]];
    const loose = composeLook([piece("a", "shirt"), piece("b", "jacket")], prefsWith({ visualLayers: layers }));
    // Both share a layer, so both normally get spread sideways.
    expect(loose.find((p) => p.id === "a")!.x).not.toBe(LOOK_FRAME_WIDTH / 2);

    const pinnedPrefs = prefsWith({
      visualLayers: layers,
      comboLayouts: { "shirt@jacket,shirt": { x: 42, y: 84 } },
    });
    const pinned = composeLook([piece("a", "shirt"), piece("b", "jacket")], pinnedPrefs);
    const shirt = pinned.find((p) => p.id === "a")!;
    expect(shirt.x).toBe(42);
    expect(shirt.y).toBe(84);
  });

  it("uses a saved combination size", () => {
    const placed = composeLook(
      [piece("a", "shirt")],
      prefsWith({ comboLayouts: { "shirt@shirt": { scale: 1.75 } } }),
    );
    expect(placed[0].scale).toBe(1.75);
  });

  /** Visual layers own the vertical band, overriding the per-category default. */
  it("lets visual layers decide the height", () => {
    const withLayers = composeLook(
      [piece("a", "shoes"), piece("b", "hat")],
      prefsWith({ visualLayers: [["shoes"], ["hat"]] }),
    );
    const y = Object.fromEntries(withLayers.map((p) => [p.id, p.y]));
    // Shoes are in the first (top) band now, so the usual order inverts.
    expect(y.a).toBeLessThan(y.b);
  });

  it("stacks by the saved layer order, frontmost highest", () => {
    const front = composeLook(
      [piece("a", "shirt"), piece("b", "jacket")],
      prefsWith({ layerOrder: ["jacket", "shirt"] }),
    );
    const z = Object.fromEntries(front.map((p) => [p.id, p.z]));
    expect(z.b).toBeGreaterThan(z.a);

    const flipped = composeLook(
      [piece("a", "shirt"), piece("b", "jacket")],
      prefsWith({ layerOrder: ["shirt", "jacket"] }),
    );
    const z2 = Object.fromEntries(flipped.map((p) => [p.id, p.z]));
    expect(z2.a).toBeGreaterThan(z2.b);
  });

  it("is deterministic", () => {
    const pieces = [piece("a", "shirt"), piece("b", "pants"), piece("c", "shoes")];
    expect(composeLook(pieces)).toEqual(composeLook(pieces));
  });

  it("survives an unknown category rather than dropping the piece", () => {
    const placed = composeLook([piece("a", "kazoo")]);
    expect(placed).toHaveLength(1);
    expect(Number.isFinite(placed[0].x)).toBe(true);
    expect(Number.isFinite(placed[0].y)).toBe(true);
  });
});

describe("lookBounds", () => {
  const size = 200;

  it("falls back to the whole frame when nothing is placed", () => {
    expect(lookBounds([], size)).toEqual({
      x: 0,
      y: 0,
      width: LOOK_FRAME_WIDTH,
      height: LOOK_FRAME_HEIGHT,
    });
  });

  it("wraps a single piece by its drawn size", () => {
    const b = lookBounds([{ id: "a", category: "shirt", x: 280, y: 480, scale: 1, z: 1 }], size);
    expect(b.x).toBe(180);
    expect(b.y).toBe(380);
    expect(b.width).toBe(200);
    expect(b.height).toBe(200);
  });

  it("accounts for a piece's own scale", () => {
    const b = lookBounds([{ id: "a", category: "jacket", x: 280, y: 480, scale: 2, z: 1 }], size);
    expect(b.width).toBe(400);
    expect(b.height).toBe(400);
  });

  it("spans every piece", () => {
    const b = lookBounds(
      [
        { id: "a", category: "hat", x: 280, y: 100, scale: 1, z: 1 },
        { id: "b", category: "shoes", x: 280, y: 800, scale: 1, z: 2 },
      ],
      size,
    );
    expect(b.y).toBe(0);
    expect(b.y + b.height).toBe(900);
  });

  it("never returns a zero-sized box", () => {
    const b = lookBounds([{ id: "a", category: "x", x: 10, y: 10, scale: 0, z: 1 }], 0);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});

describe("LookLayoutPrefs crosses the server/client boundary", () => {
  /**
   * These prefs are built in a server component (smartpakker/[tripId]/page.tsx)
   * and handed to a client one. A function on the object throws at runtime with
   * "Functions cannot be passed directly to Client Components", which no type
   * check catches — an `ancestryOf: (c) => string[]` field did exactly that and
   * took the whole trip page down.
   */
  it("carries no function-valued fields", () => {
    const prefs = prefsWith({
      categoryParents: { jeans: "pants", pants: "bottom" },
      categoryList: ["bottom", "pants", "jeans"],
    });
    for (const [key, value] of Object.entries(prefs)) {
      expect(typeof value, `${key} must be serialisable`).not.toBe("function");
    }
  });

  it("survives a JSON round trip", () => {
    const prefs = prefsWith({
      categoryParents: { jeans: "pants", pants: "bottom" },
      categoryList: ["bottom", "pants", "jeans"],
    });
    expect(JSON.parse(JSON.stringify(prefs))).toEqual(prefs);
  });

  it("still inherits a nested category's built-in size from the tree", () => {
    // "jeans" does not contain "pant", so it only reaches scale 2 by walking up
    // to "pants" — the reason the tree has to travel at all.
    const withTree = composeLook([piece("a", "jeans")], {
      ...EMPTY_LOOK_PREFS,
      categoryParents: { jeans: "pants", pants: "bottom" },
      categoryList: ["bottom", "pants", "jeans"],
    });
    const withoutTree = composeLook([piece("a", "jeans")]);
    expect(withTree[0]!.scale).toBe(2);
    expect(withoutTree[0]!.scale).toBe(1);
  });
});
