import { describe, expect, it } from "vitest";
import { existingViewPaths, resolveListingSource } from "../lib/server/ghost-mannequin-runs";

describe("resolveListingSource", () => {
  it("never seeds a new render from a previous render", () => {
    // The bug this pins: the source used to be `ghostImagePath ?? original`,
    // so once one ghost existed every later generation was handed that ghost
    // and reproduced it. New views were copies, a bad pose could not be fixed
    // by regenerating, and a prompt change did nothing until the old image was
    // deleted by hand.
    const source = resolveListingSource({
      originalImagePath: "u/photo.jpg",
      ghostImagePath: "u/ghost-abc.jpg",
    });
    expect(source).toBe("u/photo.jpg");
    expect(source).not.toBe("u/ghost-abc.jpg");
  });

  it("uses the original when there is no render yet", () => {
    expect(resolveListingSource({ originalImagePath: "u/photo.jpg" })).toBe("u/photo.jpg");
    expect(resolveListingSource({ originalImagePath: "u/photo.jpg", ghostImagePath: null })).toBe(
      "u/photo.jpg",
    );
  });

  it("follows an edited photo, because whitening repoints the original", () => {
    // replaceOriginalImageWithEdit swaps originalImagePath for the edited file,
    // so "build on the cleaned-up image" needs no ghost pointer to work.
    expect(
      resolveListingSource({
        originalImagePath: "u/whitened.jpg",
        ghostImagePath: "u/ghost-abc.jpg",
      }),
    ).toBe("u/whitened.jpg");
  });
});

describe("existingViewPaths", () => {
  it("lists every render path, for spotting a render-seeded generation", () => {
    const json = JSON.stringify([
      { label: "Ghost", imagePath: "u/ghost-1.jpg" },
      { label: "View 2", imagePath: "u/ghost-2.jpg" },
    ]);
    expect(existingViewPaths(json)).toEqual(["u/ghost-1.jpg", "u/ghost-2.jpg"]);
  });

  it("survives absent or malformed stored views", () => {
    expect(existingViewPaths(null)).toEqual([]);
    expect(existingViewPaths("not json")).toEqual([]);
    expect(existingViewPaths("[]")).toEqual([]);
    expect(existingViewPaths(JSON.stringify([{ label: "no path" }]))).toEqual([]);
  });
});
