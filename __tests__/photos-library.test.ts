import { describe, expect, it, beforeEach } from "vitest";
import {
  cacheIndex,
  isInsidePhotosLibrary,
  lookupIndexed,
  MAX_INDEXED_PHOTOS,
  type LibraryPhoto,
} from "../lib/server/photos-library";

const photo = (uuid: string, over: Partial<LibraryPhoto> = {}): LibraryPhoto => ({
  uuid,
  filename: `${uuid}.HEIC`,
  date: "2026-01-01T00:00:00",
  path: `/Users/x/Pictures/Photos Library.photoslibrary/originals/${uuid}.heic`,
  derivative: `/Users/x/Pictures/Photos Library.photoslibrary/resources/derivatives/${uuid}.jpeg`,
  persons: ["Ben"],
  missing: false,
  favorite: false,
  ...over,
});

describe("isInsidePhotosLibrary", () => {
  it("accepts a path inside a library bundle", () => {
    expect(
      isInsidePhotosLibrary(
        "/Users/x/Pictures/Photos Library.photoslibrary/resources/derivatives/A/1.jpeg",
      ),
    ).toBe(true);
  });

  it("rejects paths outside a library, including obvious traversal targets", () => {
    // The route never takes a path from the client, but this is the second gate
    // if the index is ever not what we think it is.
    for (const p of [
      "/etc/passwd",
      "/Users/x/.ssh/id_rsa",
      "/Users/x/Pictures/notaphotoslibrary/x.jpeg",
      "/Users/x/Photos Library.photoslibrary",
    ]) {
      expect(isInsidePhotosLibrary(p)).toBe(false);
    }
  });

  it("resolves traversal before checking, so ../ cannot escape", () => {
    expect(
      isInsidePhotosLibrary(
        "/Users/x/Pictures/Photos Library.photoslibrary/../../../etc/passwd",
      ),
    ).toBe(false);
  });
});

describe("index cache", () => {
  beforeEach(() => {
    cacheIndex("user-a", []);
    cacheIndex("user-b", []);
  });

  it("resolves a uuid this user indexed", () => {
    cacheIndex("user-a", [photo("AAA")]);
    expect(lookupIndexed("user-a", "AAA")?.uuid).toBe("AAA");
  });

  it("does not leak one user's index to another", () => {
    // The cache is the allowlist, so cross-user resolution would be a real leak.
    cacheIndex("user-a", [photo("AAA")]);
    expect(lookupIndexed("user-b", "AAA")).toBeNull();
  });

  it("returns null for a uuid that was never indexed", () => {
    cacheIndex("user-a", [photo("AAA")]);
    expect(lookupIndexed("user-a", "ZZZ")).toBeNull();
    expect(lookupIndexed("nobody", "AAA")).toBeNull();
  });

  it("replaces the previous index rather than merging", () => {
    // A second load must not keep the first load's paths resolvable.
    cacheIndex("user-a", [photo("AAA")]);
    cacheIndex("user-a", [photo("BBB")]);
    expect(lookupIndexed("user-a", "AAA")).toBeNull();
    expect(lookupIndexed("user-a", "BBB")?.uuid).toBe("BBB");
  });

  it("keeps the iCloud-missing flag so import can refuse it", () => {
    cacheIndex("user-a", [photo("CCC", { missing: true, path: null })]);
    const found = lookupIndexed("user-a", "CCC");
    expect(found?.missing).toBe(true);
    expect(found?.path).toBeNull();
    // The derivative survives, which is why the tile still renders.
    expect(found?.derivative).toBeTruthy();
  });

  it("lives on globalThis so the route handler sees the action's writes", () => {
    // Next compiles server actions and route handlers separately, so a plain
    // module-level Map is two Maps: the action fills one, the preview route
    // reads the other, and every thumbnail 404s "Not indexed".
    cacheIndex("user-a", [photo("AAA")]);
    const held = (globalThis as { __photosIndex?: Map<string, unknown> }).__photosIndex;
    expect(held).toBeDefined();
    expect(held!.has("user-a")).toBe(true);
  });

  it("caps the index at a size the grid can render", () => {
    expect(MAX_INDEXED_PHOTOS).toBeGreaterThan(0);
    expect(MAX_INDEXED_PHOTOS).toBeLessThanOrEqual(5000);
  });
});
