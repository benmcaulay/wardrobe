import { describe, expect, it } from "vitest";

import { PLANE_FLIGHT_MS, isScrolledToEnd, planeFlightVars } from "@/lib/packing/planner-view";

describe("plane flight duration", () => {
  it("is a fixed one-second gesture, not a progress indicator", () => {
    expect(PLANE_FLIGHT_MS).toBe(1000);
  });

  it("hands CSS the same duration the timer uses, so the two can't drift", () => {
    // The keyframes end the flight visually; the timer ends it in state. If
    // these disagree the plane either vanishes mid-route or lingers after it.
    expect(planeFlightVars()).toEqual({ "--plane-flight": `${PLANE_FLIGHT_MS}ms` });
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
