import { describe, expect, it } from "vitest";
import { vacanciesBetween, withVacancies } from "@/lib/space/vacancy";

type Tile = { id: string };
const tiles = (...ids: string[]): Tile[] => ids.map((id) => ({ id }));
const idOf = (t: Tile) => t.id;
const shape = (slots: ReturnType<typeof withVacancies<Tile>>) =>
  slots.map((s) => (s.kind === "item" ? s.item.id : "·"));

describe("vacanciesBetween", () => {
  it("finds nothing when the list is unchanged", () => {
    expect(vacanciesBetween(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("finds nothing on a first render", () => {
    // An empty previous list is a mount, not a removal — otherwise a freshly
    // loaded closet would render entirely as holes.
    expect(vacanciesBetween([], ["a", "b"])).toEqual([]);
  });

  it("records the hole where the tile actually was", () => {
    expect(vacanciesBetween(["a", "b", "c", "d"], ["a", "b", "d"])).toEqual([
      { id: "c", index: 2 },
    ]);
  });

  it("records the hole at the front when the first tile goes", () => {
    expect(vacanciesBetween(["a", "b"], ["b"])).toEqual([{ id: "a", index: 0 }]);
  });

  it("records the hole at the end when the last tile goes", () => {
    expect(vacanciesBetween(["a", "b"], ["a"])).toEqual([{ id: "b", index: 1 }]);
  });

  it("handles several removals at once with ascending indices", () => {
    expect(vacanciesBetween(["a", "b", "c", "d", "e"], ["b", "d"])).toEqual([
      { id: "a", index: 0 },
      { id: "c", index: 1 },
      { id: "e", index: 2 },
    ]);
  });

  it("ignores additions and reorders", () => {
    expect(vacanciesBetween(["a", "b"], ["b", "a", "c"])).toEqual([]);
  });
});

describe("withVacancies", () => {
  it("returns the plain list when there are no holes", () => {
    expect(shape(withVacancies(tiles("a", "b"), [], idOf))).toEqual(["a", "b"]);
  });

  it("puts a single hole back where it belongs", () => {
    const holes = vacanciesBetween(["a", "b", "c", "d"], ["a", "b", "d"]);
    expect(shape(withVacancies(tiles("a", "b", "d"), holes, idOf))).toEqual([
      "a",
      "b",
      "·",
      "d",
    ]);
  });

  it("keeps several holes in the right places despite each shifting the next", () => {
    const holes = vacanciesBetween(["a", "b", "c", "d", "e"], ["b", "d"]);
    expect(shape(withVacancies(tiles("b", "d"), holes, idOf))).toEqual([
      "·",
      "b",
      "·",
      "d",
      "·",
    ]);
  });

  it("drops a hole whose piece came back", () => {
    // Undo, or a refresh that restored the item. Without this the grid keeps a
    // permanent hole next to the tile it was supposed to replace.
    const holes = [{ id: "c", index: 2 }];
    expect(shape(withVacancies(tiles("a", "b", "c"), holes, idOf))).toEqual(["a", "b", "c"]);
  });

  it("clamps an index past the end of a list that shrank further", () => {
    const holes = [{ id: "z", index: 9 }];
    expect(shape(withVacancies(tiles("a"), holes, idOf))).toEqual(["a", "·"]);
  });

  it("gives holes keys that cannot collide with item keys", () => {
    const slots = withVacancies(tiles("a"), [{ id: "b", index: 1 }], idOf);
    expect(new Set(slots.map((s) => s.key)).size).toBe(slots.length);
    expect(slots[1].key).toBe("vacancy:b");
  });
});
