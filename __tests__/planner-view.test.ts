import { describe, expect, it } from "vitest";

import { isScrolledToEnd, planeRouteState } from "@/lib/packing/planner-view";

describe("planeRouteState", () => {
  it("parks the plane until something has been packed", () => {
    expect(planeRouteState({ packing: false, packed: false })).toBe("idle");
  });

  it("flies while a pack is running", () => {
    expect(planeRouteState({ packing: true, packed: false })).toBe("flying");
  });

  it("lands once a plan comes back", () => {
    expect(planeRouteState({ packing: false, packed: true })).toBe("landed");
  });

  it("takes off again for a re-pack rather than sitting at the destination", () => {
    expect(planeRouteState({ packing: true, packed: true })).toBe("flying");
  });
});

describe("isScrolledToEnd", () => {
  it("is false at the top of a scrollable column, so the fade shows", () => {
    expect(isScrolledToEnd({ scrollHeight: 1200, scrollTop: 0, clientHeight: 400 })).toBe(false);
  });

  it("is false partway down", () => {
    expect(isScrolledToEnd({ scrollHeight: 1200, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });

  it("is true at the bottom", () => {
    expect(isScrolledToEnd({ scrollHeight: 1200, scrollTop: 800, clientHeight: 400 })).toBe(true);
  });

  it("absorbs sub-pixel drift so the fade doesn't stick on at the end", () => {
    // Fractional row heights leave a fraction of a pixel unscrolled.
    expect(isScrolledToEnd({ scrollHeight: 1200.6, scrollTop: 799.2, clientHeight: 400 })).toBe(
      true,
    );
    // But a genuine remaining row is not "the end".
    expect(isScrolledToEnd({ scrollHeight: 1240, scrollTop: 800, clientHeight: 400 })).toBe(false);
  });

  it("is true when there's nothing to scroll", () => {
    expect(isScrolledToEnd({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 })).toBe(true);
  });
});
