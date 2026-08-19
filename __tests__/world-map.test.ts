import { describe, expect, it } from "vitest";
import {
  MAP_ASPECT_RATIO,
  REGION_SPAN_DEGREES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  placeOnViewport,
  project,
  regionViewport,
  unitScale,
  viewBoxOf,
  worldViewport,
  zoomTransform,
} from "@/lib/packing/world-map";
import { WORLD_COUNTRIES, WORLD_UNCODED_LAND } from "@/lib/packing/world-map-data";

/**
 * The projection here must match the one in scripts/build-world-map.ts exactly.
 * If they drift the pin lands in the sea, and nothing else in the app would
 * notice — hence pinning real cities to real projected coordinates.
 */
describe("projection", () => {
  it("puts the origin at the centre of the canvas", () => {
    expect(project(0, 0)).toEqual({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
  });

  it("maps the corners of the graticule to the corners of the canvas", () => {
    expect(project(-180, 90)).toEqual({ x: 0, y: 0 });
    expect(project(180, -90)).toEqual({ x: WORLD_WIDTH, y: WORLD_HEIGHT });
  });

  it("places known cities where they belong", () => {
    // Seoul: 37.5665N, 126.978E → east of centre, north of centre.
    const seoul = project(126.978, 37.5665);
    expect(seoul.x).toBeCloseTo(852.72, 1);
    expect(seoul.y).toBeCloseTo(145.65, 1);

    // Sydney is south of the equator, so below the midline.
    expect(project(151.2073, -33.8679).y).toBeGreaterThan(WORLD_HEIGHT / 2);
    // Reykjavík is west of Greenwich, so left of the midline.
    expect(project(-21.8954, 64.1355).x).toBeLessThan(WORLD_WIDTH / 2);
  });
});

describe("worldViewport", () => {
  it("spans the full width and stays inside the canvas", () => {
    const view = worldViewport();
    expect(view.x).toBe(0);
    expect(view.width).toBe(WORLD_WIDTH);
    expect(view.y).toBeGreaterThan(0);
    expect(view.y + view.height).toBeLessThanOrEqual(WORLD_HEIGHT);
  });

  it("matches the card's aspect ratio exactly, so nothing is letterboxed", () => {
    const view = worldViewport();
    expect(view.width / view.height).toBeCloseTo(MAP_ASPECT_RATIO, 6);
  });
});

describe("regionViewport", () => {
  const seoul = { latitude: 37.5665, longitude: 126.978 };

  it("centres on the point and spans the requested longitude", () => {
    const view = regionViewport(seoul);
    const { x, y } = project(seoul.longitude, seoul.latitude);
    expect(view.x + view.width / 2).toBeCloseTo(x, 6);
    expect(view.y + view.height / 2).toBeCloseTo(y, 6);
    expect((view.width / WORLD_WIDTH) * 360).toBeCloseTo(REGION_SPAN_DEGREES, 6);
  });

  it("keeps the card's aspect ratio", () => {
    expect(regionViewport(seoul).width / regionViewport(seoul).height).toBeCloseTo(
      MAP_ASPECT_RATIO,
      6,
    );
  });

  it("falls back to the world view without coordinates", () => {
    expect(regionViewport(null)).toEqual(worldViewport());
  });

  it("ignores coordinates that aren't numbers", () => {
    expect(regionViewport({ latitude: NaN, longitude: 12 })).toEqual(worldViewport());
  });

  /**
   * The clamp is what stops the window changing size at the edges of the map.
   * A destination near the antimeridian or the poles slides its window inward
   * rather than shrinking it — an off-centre pin still reads, a squashed
   * window doesn't.
   */
  it.each([
    ["Suva, near the antimeridian", { latitude: -18.14, longitude: 178.44 }],
    ["Anadyr, the other side of it", { latitude: 64.73, longitude: 177.51 }],
    ["Ushuaia, far south", { latitude: -54.8, longitude: -68.3 }],
    ["Longyearbyen, far north", { latitude: 78.22, longitude: 15.63 }],
    ["Honolulu, mid-Pacific", { latitude: 21.31, longitude: -157.86 }],
  ])("stays inside the canvas at full size for %s", (_label, point) => {
    const view = regionViewport(point);
    const world = regionViewport({ latitude: 0, longitude: 0 });
    expect(view.width).toBeCloseTo(world.width, 6);
    expect(view.height).toBeCloseTo(world.height, 6);
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.x + view.width).toBeLessThanOrEqual(WORLD_WIDTH + 1e-9);
    expect(view.y + view.height).toBeLessThanOrEqual(WORLD_HEIGHT + 1e-9);
  });

  it("never zooms out past the whole canvas", () => {
    const view = regionViewport({ latitude: 0, longitude: 0 }, 720);
    expect(view.width).toBeLessThanOrEqual(WORLD_WIDTH);
    expect(view.height).toBeLessThanOrEqual(WORLD_HEIGHT);
  });
});

describe("unitScale", () => {
  it("is 1 when the viewport is the full canvas width", () => {
    expect(unitScale({ x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT })).toBe(1);
  });

  it("grows as the viewport narrows, so strokes can be divided by it", () => {
    expect(unitScale(regionViewport({ latitude: 0, longitude: 0 }))).toBeCloseTo(360 / REGION_SPAN_DEGREES, 6);
  });
});

describe("zoomTransform", () => {
  const seoul = { latitude: 37.5665, longitude: 126.978 };

  /**
   * The bug this guards: the transform was first written in SVG attribute
   * syntax — `translate(10 5)` — which is invalid as CSS. Browsers drop the
   * whole declaration without a word, and the map silently never zoomed.
   */
  it("emits CSS syntax, with units and a comma", () => {
    const t = zoomTransform(worldViewport(), regionViewport(seoul));
    expect(t).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)$/);
  });

  it("is the identity when the target is the frame itself", () => {
    const world = worldViewport();
    expect(zoomTransform(world, world)).toBe("translate(0px, 0px) scale(1)");
  });

  it("scales by the ratio of the widths", () => {
    const t = zoomTransform(worldViewport(), regionViewport(seoul));
    expect(Number(/scale\(([\d.]+)\)/.exec(t)![1])).toBeCloseTo(360 / REGION_SPAN_DEGREES, 2);
  });

  /**
   * The transform is applied about user-space (0,0), so a point v lands at
   * k·v + t. That origin was confirmed in a browser with `getScreenCTM`;
   * assuming the viewBox corner instead put the pin 119 units off the city.
   * Re-deriving the landing point here is what stops that coming back.
   */
  it("lands the target's centre in the middle of the frame", () => {
    const world = worldViewport();
    const target = regionViewport(seoul);
    const t = zoomTransform(world, target);
    const [, tx, ty, k] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/
      .exec(t)!
      .map(Number) as unknown as [string, number, number, number];

    const apply = (v: { x: number; y: number }) => ({ x: k * v.x + tx, y: k * v.y + ty });

    // Tolerance is in canvas units, of which the card is 1000 wide — so 0.01
    // here is well under a hundredth of a pixel on screen. It exists only to
    // absorb the rounding in the emitted string.
    const centreOfTarget = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const landed = apply(centreOfTarget);
    expect(landed.x).toBeCloseTo(world.x + world.width / 2, 2);
    expect(landed.y).toBeCloseTo(world.y + world.height / 2, 2);

    // And the target's corners should land on the frame's corners.
    const topLeft = apply({ x: target.x, y: target.y });
    expect(topLeft.x).toBeCloseTo(world.x, 2);
    expect(topLeft.y).toBeCloseTo(world.y, 2);
  });
});

describe("placeOnViewport", () => {
  it("puts the pin dead centre when the region is centred on it", () => {
    const seoul = { latitude: 37.5665, longitude: 126.978 };
    const world = worldViewport();
    const pin = placeOnViewport(seoul, world, regionViewport(seoul));
    expect(pin.x).toBeCloseTo(world.x + world.width / 2, 3);
    expect(pin.y).toBeCloseTo(world.y + world.height / 2, 3);
  });

  it("agrees with the raw projection in the world view", () => {
    const world = worldViewport();
    const point = { latitude: 37.5665, longitude: 126.978 };
    const pin = placeOnViewport(point, world, world);
    expect(pin).toEqual(project(point.longitude, point.latitude));
  });

  /**
   * Near the antimeridian the region viewport is slid inward by the clamp, so
   * the pin is deliberately off-centre — but it must still be inside the frame,
   * or the map shows a window with no dot in it.
   */
  it("keeps a clamped destination inside the frame", () => {
    const world = worldViewport();
    for (const point of [
      { latitude: -18.14, longitude: 178.44 },
      { latitude: 78.22, longitude: 15.63 },
      { latitude: 21.31, longitude: -157.86 },
    ]) {
      const pin = placeOnViewport(point, world, regionViewport(point));
      expect(pin.x).toBeGreaterThanOrEqual(world.x);
      expect(pin.x).toBeLessThanOrEqual(world.x + world.width);
      expect(pin.y).toBeGreaterThanOrEqual(world.y);
      expect(pin.y).toBeLessThanOrEqual(world.y + world.height);
    }
  });
});

describe("viewBoxOf", () => {
  it("renders four space-separated numbers", () => {
    expect(viewBoxOf({ x: 1.234, y: 2, width: 3, height: 4.567 })).toBe("1.23 2 3 4.57");
  });
});

/**
 * Walk generated path data back into absolute points.
 *
 * The generator writes "M<x> <y>l<dx> <dy> …Z" with no space before the
 * command letters, so the coordinates can't be recovered by splitting on
 * whitespace alone — everything after the first `l` is a delta from the
 * running position.
 */
function pathPoints(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const sub of d.split("M").slice(1)) {
    const [head, tail = ""] = sub.split("l");
    const [x0, y0] = head.trim().split(/\s+/).map(Number);
    let x = x0;
    let y = y0;
    points.push({ x, y });
    const deltas = tail.replace(/Z/g, "").trim();
    if (!deltas) continue;
    const nums = deltas.split(/\s+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      x += nums[i];
      y += nums[i + 1];
      points.push({ x, y });
    }
  }
  return points;
}

describe("baked map data", () => {
  it("covers the countries a trip is likely to reach", () => {
    for (const code of ["KR", "JP", "US", "GB", "FR", "PT", "IS", "AU", "BR", "ZA", "NO"]) {
      expect(WORLD_COUNTRIES[code], `missing ${code}`).toBeTruthy();
    }
  });

  it("only emits closed subpaths starting with an absolute move", () => {
    for (const [code, d] of Object.entries(WORLD_COUNTRIES)) {
      expect(d.startsWith("M"), `${code} does not start with M`).toBe(true);
      expect(d.endsWith("Z"), `${code} is not closed`).toBe(true);
    }
  });

  /**
   * Every coordinate has to sit inside the canvas the viewports are clamped
   * to. A stray vertex means the projection in the generator disagreed with
   * the one here, which is exactly the drift these tests exist to catch.
   */
  it("stays within the canvas", () => {
    const points = pathPoints(
      `${Object.values(WORLD_COUNTRIES).join("")}${WORLD_UNCODED_LAND}`,
    );
    expect(points.length).toBeGreaterThan(5000);

    // A tenth of a unit of slack for the generator's rounding.
    expect(Math.min(...points.map((p) => p.x))).toBeGreaterThanOrEqual(-0.1);
    expect(Math.min(...points.map((p) => p.y))).toBeGreaterThanOrEqual(-0.1);
    expect(Math.max(...points.map((p) => p.x))).toBeLessThanOrEqual(WORLD_WIDTH + 0.1);
    expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(WORLD_HEIGHT + 0.1);
  });

  it("draws South Korea around Seoul", () => {
    // The highlight and the pin have to agree, and they come from different
    // code — the generator's projection and this module's. If they drift, the
    // country lights up somewhere the dot isn't.
    const seoul = project(126.978, 37.5665);
    const nearest = Math.min(
      ...pathPoints(WORLD_COUNTRIES.KR).map((p) => Math.hypot(p.x - seoul.x, p.y - seoul.y)),
    );
    // 5 canvas units is ~1.8° of longitude — comfortably inside the peninsula,
    // and far tighter than the width of any neighbouring country.
    expect(nearest).toBeLessThan(5);
  });
});
