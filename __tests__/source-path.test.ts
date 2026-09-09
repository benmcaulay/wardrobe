import { describe, it, expect } from "vitest";
import { sourcePathFor, thumbnailPathFor, isGhostImagePath } from "../lib/image-paths";

describe("sourcePathFor", () => {
  it("inserts -src before the extension", () => {
    expect(sourcePathFor("uid/a1b2.jpg")).toBe("uid/a1b2-src.jpg");
    expect(sourcePathFor("uid/ghost-abc.png")).toBe("uid/ghost-abc-src.png");
  });

  it("appends when there is no extension", () => {
    expect(sourcePathFor("uid/noext")).toBe("uid/noext-src");
  });

  it("is not confused by a dot in a directory name", () => {
    expect(sourcePathFor("u.id/file")).toBe("u.id/file-src");
  });

  it("does not collide with the thumbnail convention", () => {
    const p = "uid/a1b2.jpg";
    expect(sourcePathFor(p)).not.toBe(thumbnailPathFor(p));
  });
});

describe("isGhostImagePath", () => {
  it("excludes the -src sibling of a ghost render", () => {
    // Otherwise a temporary source would be treated as a real render and
    // offered as a view.
    expect(isGhostImagePath("uid/ghost-abc.jpg")).toBe(true);
    expect(isGhostImagePath("uid/ghost-abc-src.jpg")).toBe(false);
  });
});
