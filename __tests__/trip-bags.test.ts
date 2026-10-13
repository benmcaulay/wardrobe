import { describe, it, expect } from "vitest";
import { setTripBags, swapTripBag, type TripBagState } from "../lib/packing/trip-bags";

const state = (over: Partial<TripBagState> = {}): TripBagState => ({
  bagIds: ["duffel", "carryon"],
  assignments: { duffel: ["shirt", "jeans"], carryon: ["jacket"] },
  gear: { duffel: ["charger"] },
  ...over,
});

describe("swapTripBag", () => {
  it("takes the old bag's place in the list, not the end of it", () => {
    const out = swapTripBag(state(), "duffel", "backpack");
    expect(out.bagIds).toEqual(["backpack", "carryon"]);
  });

  it("carries both garments and gear across", () => {
    const out = swapTripBag(state(), "duffel", "backpack");
    expect(out.assignments.backpack).toEqual(["shirt", "jeans"]);
    expect(out.gear.backpack).toEqual(["charger"]);
  });

  it("leaves nothing behind under the old key", () => {
    // A stranded entry is invisible in the plan and springs back if the bag
    // is ever re-added.
    const out = swapTripBag(state(), "duffel", "backpack");
    expect(out.assignments).not.toHaveProperty("duffel");
    expect(out.gear).not.toHaveProperty("duffel");
  });

  it("does not disturb the other bags", () => {
    const out = swapTripBag(state(), "duffel", "backpack");
    expect(out.assignments.carryon).toEqual(["jacket"]);
  });

  it("swapping an empty bag still removes its key", () => {
    const out = swapTripBag(state({ assignments: { duffel: [] } }), "duffel", "backpack");
    expect(out.assignments).not.toHaveProperty("duffel");
    expect(out.assignments.backpack).toBeUndefined();
  });

  it("merges when the destination is already on the trip", () => {
    const out = swapTripBag(state(), "duffel", "carryon");
    expect(out.bagIds).toEqual(["carryon"]);
    // What was deliberately packed in the destination keeps its place.
    expect(out.assignments.carryon).toEqual(["jacket", "shirt", "jeans"]);
  });

  it("does not duplicate an item the destination already holds", () => {
    const out = swapTripBag(
      state({ assignments: { duffel: ["shirt"], carryon: ["shirt", "jacket"] } }),
      "duffel",
      "carryon",
    );
    expect(out.assignments.carryon).toEqual(["shirt", "jacket"]);
  });

  it("is a no-op for a bag that is not on the trip, or for itself", () => {
    expect(swapTripBag(state(), "unknown", "backpack")).toEqual(state());
    expect(swapTripBag(state(), "duffel", "duffel")).toEqual(state());
  });
});

describe("setTripBags", () => {
  it("adds a bag without giving it contents", () => {
    const out = setTripBags(state(), ["duffel", "carryon", "backpack"]);
    expect(out.bagIds).toEqual(["duffel", "carryon", "backpack"]);
    expect(out.assignments.backpack).toBeUndefined();
  });

  it("removing a bag returns its contents to unpacked rather than deleting them", () => {
    // Unpacked is "in no bag's list", so dropping the entry is the whole move.
    const out = setTripBags(state(), ["carryon"]);
    expect(out.assignments).toEqual({ carryon: ["jacket"] });
    expect(out.gear).toEqual({});
  });

  it("keeps the order it was given", () => {
    expect(setTripBags(state(), ["carryon", "duffel"]).bagIds).toEqual(["carryon", "duffel"]);
  });

  it("tolerates a repeated id", () => {
    expect(setTripBags(state(), ["duffel", "duffel"]).bagIds).toEqual(["duffel"]);
  });

  it("clearing every bag strands nothing", () => {
    const out = setTripBags(state(), []);
    expect(out).toEqual({ bagIds: [], assignments: {}, gear: {} });
  });
});
