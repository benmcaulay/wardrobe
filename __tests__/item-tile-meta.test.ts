import { describe, expect, it } from "vitest";
import {
  itemTileImageTransform,
  itemTileTransformSuffix,
  readItemTileMeta,
  readPrimaryGhostTileMeta,
} from "@/lib/item-tile-meta";

/**
 * These three surfaces now read framing through this module — the closet grid,
 * the outfit canvas, and (new) trip packing: the orbiting piece, the rail
 * thumbnail, the flying piece, and the looks carousel. A flip saved on an item
 * has to mean the same thing in all of them, which is what makes the precedence
 * rule below worth pinning rather than leaving to each caller.
 */

const plain = {
  ghostViews: null,
  ghostImagePath: null,
  originalMirror: null,
  originalThumbZoom: null,
};

describe("readItemTileMeta", () => {
  it("defaults to no framing when nothing is saved", () => {
    expect(readItemTileMeta(plain)).toEqual({ mirror: false, thumbZoom: 1 });
  });

  it("reads the original photo's framing when there is no ghost render", () => {
    expect(
      readItemTileMeta({ ...plain, originalMirror: true, originalThumbZoom: 1.4 }),
    ).toEqual({ mirror: true, thumbZoom: 1.4 });
  });

  /**
   * Precedence matters because packing shows `ghostImagePath ?? originalImagePath`.
   * Framing the ghost render with the original photo's flip would mirror the
   * wrong picture.
   */
  it("prefers the ghost view's framing once a ghost render exists", () => {
    const meta = readItemTileMeta({
      ghostImagePath: "ghost/a.png",
      ghostViews: JSON.stringify([
        { imagePath: "ghost/a.png", mirror: true, thumbZoom: 1.2 },
        { imagePath: "ghost/b.png", mirror: false, thumbZoom: 2 },
      ]),
      originalMirror: false,
      originalThumbZoom: 1,
    });
    expect(meta).toEqual({ mirror: true, thumbZoom: 1.2 });
  });

  it("does not fall back to the original when the ghost view is unframed", () => {
    // A ghost render the user has never adjusted must show unflipped, even if
    // they had flipped the original photo earlier.
    const meta = readItemTileMeta({
      ghostImagePath: "ghost/a.png",
      ghostViews: JSON.stringify([{ imagePath: "ghost/a.png" }]),
      originalMirror: true,
      originalThumbZoom: 1.5,
    });
    expect(meta).toEqual({ mirror: false, thumbZoom: 1 });
  });
});

describe("readPrimaryGhostTileMeta", () => {
  it("survives malformed stored JSON", () => {
    expect(readPrimaryGhostTileMeta("{not json", "ghost/a.png")).toEqual({
      mirror: false,
      thumbZoom: 1,
    });
  });

  it("returns no framing when no view matches the shown render", () => {
    const views = JSON.stringify([{ imagePath: "ghost/b.png", mirror: true }]);
    expect(readPrimaryGhostTileMeta(views, "ghost/a.png")).toEqual({
      mirror: false,
      thumbZoom: 1,
    });
  });
});

describe("itemTileImageTransform", () => {
  it("is 'none' rather than an empty string when unframed", () => {
    // Empty would be an invalid transform value; "none" is what resets it.
    expect(itemTileImageTransform({ mirror: false, thumbZoom: 1 })).toBe("none");
  });

  it("scales before mirroring, so the flip is about the piece's own centre", () => {
    expect(itemTileImageTransform({ mirror: true, thumbZoom: 1.25 })).toBe(
      "scale(1.25) scaleX(-1)",
    );
  });

  it("emits only the part that differs from the default", () => {
    expect(itemTileImageTransform({ mirror: true, thumbZoom: 1 })).toBe("scaleX(-1)");
    expect(itemTileImageTransform({ mirror: false, thumbZoom: 2 })).toBe("scale(2)");
  });
});

describe("itemTileTransformSuffix", () => {
  /**
   * The looks carousel appends this to `translate(-50%,-50%) scale(n)`. If an
   * unframed item yielded " none" the whole declaration would be invalid and
   * every piece in every look would collapse to the top-left corner — so the
   * empty case is the one that matters.
   */
  it("is empty for an unframed item, not ' none'", () => {
    expect(itemTileTransformSuffix({ mirror: false, thumbZoom: 1 })).toBe("");
    expect(itemTileTransformSuffix(null)).toBe("");
    expect(itemTileTransformSuffix(undefined)).toBe("");
  });

  it("leads with a space so it appends to an existing transform list", () => {
    expect(itemTileTransformSuffix({ mirror: true, thumbZoom: 1 })).toBe(" scaleX(-1)");
    expect(itemTileTransformSuffix({ mirror: true, thumbZoom: 1.25 })).toBe(
      " scale(1.25) scaleX(-1)",
    );
  });
});
