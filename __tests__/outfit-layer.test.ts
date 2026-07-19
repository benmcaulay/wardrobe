import { describe, expect, it } from "vitest";
import { swapLayerOrder } from "../lib/outfit-layer";

describe("swapLayerOrder", () => {
  const pieces = [
    { id: "a", z: 1 },
    { id: "b", z: 2 },
    { id: "c", z: 3 },
  ];

  it("swaps forward", () => {
    const next = swapLayerOrder(pieces, "b", 1);
    expect(next).toEqual([
      { id: "a", z: 1 },
      { id: "b", z: 3 },
      { id: "c", z: 2 },
    ]);
  });

  it("swaps backward", () => {
    const next = swapLayerOrder(pieces, "b", -1);
    expect(next).toEqual([
      { id: "a", z: 2 },
      { id: "b", z: 1 },
      { id: "c", z: 3 },
    ]);
  });

  it("returns null at stack edge", () => {
    expect(swapLayerOrder(pieces, "a", -1)).toBeNull();
    expect(swapLayerOrder(pieces, "c", 1)).toBeNull();
  });
});
