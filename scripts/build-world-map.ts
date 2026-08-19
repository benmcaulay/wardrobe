/**
 * Bake a world map into a static TypeScript module.
 *
 * The trip page wants a small map window showing where you're going. Every
 * off-the-shelf way to do that — Mapbox, Leaflet + a tile host, a static-image
 * API — costs a runtime dependency, an account, an API key, and a network
 * request per render, and hands back raster tiles that look nothing like the
 * rest of the app. For a window this size that's a bad trade: we don't need
 * roads or labels, we need "here is the shape of the land, and here is the
 * dot".
 *
 * So we bake it. Natural Earth's 110m country polygons (public domain) get
 * projected, simplified, and written out as SVG path data in
 * `lib/packing/world-map-data.ts`. The result renders instantly, works
 * offline, costs no key, and strokes with `currentColor` like every other
 * piece of line art in the app.
 *
 * Regenerate with:  pnpm map:build
 *
 * Output is committed. This script is not part of the build — it only runs
 * when we want different source data or a different simplification.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Two source resolutions, because one is never right for both ends of the
 * scale. See `pickSource`.
 */
const SOURCE_COARSE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const SOURCE_FINE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

const OUT_PATH = path.join(process.cwd(), "lib/packing/world-map-data.ts");

/**
 * Projected canvas. Equirectangular (plate carrée): longitude maps straight to
 * x, latitude straight to y. It's the projection with the least machinery —
 * placing a pin is two multiplications, which is the whole reason to prefer it
 * over Mercator here. It stretches the poles, but a window showing one city
 * doesn't care, and `lib/packing/world-map.ts` documents the maths so the
 * component and this script can't drift apart.
 */
const WIDTH = 1000;
const HEIGHT = 500;

/**
 * Simplification tolerance, as a fraction of a ring's own size.
 *
 * A single global tolerance is what made South Korea unrecognisable. Douglas–
 * Peucker works in absolute distance, so 0.5 units against China's ~170-unit
 * span is a rounding error, while against the peninsula's ~13 units it's 4% of
 * the whole country — enough to straighten it into a blob. Detail should be
 * spent where it's scarce.
 *
 * So the tolerance is derived per ring from its own extent: constant *relative*
 * error rather than constant absolute error. Small countries get a proportional
 * share of the vertex budget instead of whatever is left after the continents
 * have taken theirs.
 */
const RELATIVE_TOLERANCE = 0.006;

/**
 * Ceiling on that tolerance, and the value every large landmass lands on.
 *
 * Deliberately the old global figure: anything big enough to hit this ceiling
 * is simplified exactly as it was before, so this change only ever *adds*
 * detail to the things that were missing it.
 */
const MAX_TOLERANCE = 0.5;

/** Floor, so a tiny island doesn't ask for more precision than the data has. */
const MIN_TOLERANCE = 0.05;

/**
 * A country described by fewer than this many points in the 110m source is
 * redrawn from the 50m one.
 *
 * Natural Earth allocates vertices by coastline length at a fixed resolution,
 * so 110m gives China 240 points and South Korea 19 — not enough to describe a
 * peninsula at *any* tolerance, which is why tuning the simplifier alone could
 * never fix it. 50m gives Korea 260.
 *
 * The test is the vertex count itself rather than the country's size: Iceland
 * is small but wide, and a bounding-box rule leaves it on the coarse source
 * with the same 18-point coastline that made Korea unrecognisable.
 *
 * Only the under-described switch. 50m for everything costs 49kB gzipped
 * against 19kB, nearly all of it spent on Russia and Canada — whose coastlines
 * were never the problem.
 */
const COARSE_VERTEX_FLOOR = 80;

/** The tolerance for one ring, from the longer side of its bounding box. */
function toleranceFor(ring: Ring): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  return Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, extent * RELATIVE_TOLERANCE));
}

/**
 * Drop rings smaller than this in projected square units. Clears the specks —
 * single-pixel islands that cost bytes and render as dirt — without touching
 * anything you'd notice missing. Deliberately small: at continent zoom a
 * 0.6-unit island is still a visible dot.
 */
const MIN_AREA = 0.6;

type Point = [number, number];
type Ring = Point[];

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type Feature = {
  properties: Record<string, unknown>;
  geometry: Geometry | null;
};

/* --------------------------------------------------------------- geometry --- */

function project(lon: number, lat: number): Point {
  return [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT];
}

/** Perpendicular distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const [px, py] = p;
  let [ax, ay] = a;
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      [ax, ay] = b;
    } else if (t > 0) {
      ax += dx * t;
      ay += dy * t;
    }
  }
  return Math.hypot(px - ax, py - ay);
}

/** Douglas–Peucker, iterative so a pathological ring can't blow the stack. */
function simplify(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let index = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = segmentDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/** Shoelace area, unsigned. Used only to decide whether a ring is worth keeping. */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum / 2);
}

const round = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  // "12" beats "12.0", and "-0" is never what we mean.
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * One ring as an SVG subpath, written relative to the previous point.
 *
 * Relative `l` commands are what make the payload small: coastline vertices are
 * neighbours, so deltas are one or two characters where absolutes are four or
 * five. Roughly a third off the total.
 */
function ringToPath(ring: Ring): string {
  const parts: string[] = [`M${round(ring[0][0])} ${round(ring[0][1])}`];
  // Track the *rounded* position, not the true one — otherwise rounding error
  // accumulates along the ring and the coastline drifts off the coast.
  let cx = Math.round(ring[0][0] * 10) / 10;
  let cy = Math.round(ring[0][1] * 10) / 10;
  const deltas: string[] = [];
  for (let i = 1; i < ring.length; i += 1) {
    const nx = Math.round(ring[i][0] * 10) / 10;
    const ny = Math.round(ring[i][1] * 10) / 10;
    if (nx === cx && ny === cy) continue;
    deltas.push(`${round(nx - cx)} ${round(ny - cy)}`);
    cx = nx;
    cy = ny;
  }
  if (deltas.length === 0) return "";
  parts.push(`l${deltas.join(" ")}`, "Z");
  return parts.join("");
}

/** Every ring of a feature's geometry, projected. */
function ringsOf(geometry: Geometry): Ring[] {
  const polygons: number[][][][] =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings: Ring[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      rings.push(ring.map(([lon, lat]) => project(lon, lat)));
    }
  }
  return rings;
}

/* ------------------------------------------------------------------ build --- */

/**
 * The ISO 3166-1 alpha-2 code to file a feature under.
 *
 * Natural Earth writes "-99" into ISO_A2 for disputed and dependent
 * territories — including France and Norway, whose codes live in ISO_A2_EH
 * instead. Preferring the _EH field means a trip to Paris actually highlights
 * a country rather than silently matching nothing.
 */
function isoCode(properties: Record<string, unknown>): string | null {
  for (const key of ["ISO_A2_EH", "ISO_A2"]) {
    const value = properties[key];
    if (typeof value === "string" && /^[A-Z]{2}$/.test(value)) return value;
  }
  return null;
}

async function fetchCollection(url: string): Promise<Feature[]> {
  process.stdout.write(`Fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Source returned ${res.status}`);
  return ((await res.json()) as { features: Feature[] }).features;
}

/** How many points the source spends on a feature. */
function vertexCount(geometry: Geometry): number {
  let n = 0;
  for (const ring of ringsOf(geometry)) n += ring.length;
  return n;
}

async function main() {
  const [coarse, fine] = await Promise.all([
    fetchCollection(SOURCE_COARSE),
    fetchCollection(SOURCE_FINE),
  ]);

  /*
   * One feature per country: the fine one when the country is small enough to
   * need it, the coarse one otherwise. Anything the coarse source doesn't have
   * at all (small territories it omits) comes from the fine source too.
   */
  const fineByCode = new Map<string, Feature>();
  for (const feature of fine) {
    const code = feature.geometry ? isoCode(feature.properties) : null;
    if (code && !fineByCode.has(code)) fineByCode.set(code, feature);
  }

  const chosen: Feature[] = [];
  const usedFine = new Set<string>();
  for (const feature of coarse) {
    if (!feature.geometry) continue;
    const code = isoCode(feature.properties);
    const replacement = code ? fineByCode.get(code) : undefined;
    if (
      code &&
      replacement?.geometry &&
      vertexCount(feature.geometry) < COARSE_VERTEX_FLOOR
    ) {
      chosen.push(replacement);
      usedFine.add(code);
    } else {
      chosen.push(feature);
    }
  }
  for (const [code, feature] of fineByCode) {
    if (!usedFine.has(code) && !chosen.some((f) => isoCode(f.properties) === code)) {
      chosen.push(feature);
      usedFine.add(code);
    }
  }

  const collection = { features: chosen };

  // Several features can share a code (a mainland plus its islands as separate
  // records), so accumulate rather than assign.
  const byCode = new Map<string, string[]>();
  const unmatched: string[] = [];
  let keptRings = 0;
  let droppedRings = 0;
  let sourceVertices = 0;
  let keptVertices = 0;

  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const code = isoCode(feature.properties);
    const paths: string[] = [];

    for (const ring of ringsOf(feature.geometry)) {
      sourceVertices += ring.length;
      if (ringArea(ring) < MIN_AREA) {
        droppedRings += 1;
        continue;
      }
      const reduced = simplify(ring, toleranceFor(ring));
      // Two points enclose no area; three is the smallest thing worth drawing.
      if (reduced.length < 4) {
        droppedRings += 1;
        continue;
      }
      const d = ringToPath(reduced);
      if (!d) {
        droppedRings += 1;
        continue;
      }
      keptRings += 1;
      keptVertices += reduced.length;
      paths.push(d);
    }

    if (paths.length === 0) continue;
    if (!code) {
      // Keep the land — it just can't be highlighted. Antarctica and a handful
      // of disputed areas land here; a map missing them would read as broken.
      unmatched.push(...paths);
      continue;
    }
    byCode.set(code, [...(byCode.get(code) ?? []), ...paths]);
  }

  const codes = [...byCode.keys()].sort();
  const entries = codes.map((code) => `  ${code}: ${JSON.stringify(byCode.get(code)!.join(""))},`);

  const module = `/**
 * World map path data — GENERATED by scripts/build-world-map.ts. Do not edit.
 *
 * Natural Earth 110m admin-0 countries (public domain), projected
 * equirectangular onto a ${WIDTH}×${HEIGHT} canvas and simplified with
 * Douglas–Peucker at a per-country tolerance — ${RELATIVE_TOLERANCE} of each
 * ring's own extent, clamped to [${MIN_TOLERANCE}, ${MAX_TOLERANCE}] — so small
 * countries keep their shape. See lib/packing/world-map.ts for the projection
 * and the viewport maths that consume this.
 *
 * Sources: ${SOURCE_COARSE}
 *          ${SOURCE_FINE} (countries the coarse source gives under
 *          ${COARSE_VERTEX_FLOOR} points)
 */

/** Projected canvas the path data is drawn in. */
export const WORLD_WIDTH = ${WIDTH};
export const WORLD_HEIGHT = ${HEIGHT};

/**
 * Country outlines keyed by ISO 3166-1 alpha-2. Each value is one or more
 * closed subpaths — a country with islands is a single string.
 */
export const WORLD_COUNTRIES: Record<string, string> = {
${entries.join("\n")}
};

/**
 * Land that carries no ISO alpha-2 code in the source data — Antarctica,
 * Northern Cyprus, Somaliland, and similar. Drawn with the rest so the map is
 * whole; simply never highlighted.
 */
export const WORLD_UNCODED_LAND = ${JSON.stringify(unmatched.join(""))};
`;

  await writeFile(OUT_PATH, module, "utf8");

  const bytes = Buffer.byteLength(module, "utf8");
  process.stdout.write(
    [
      `Wrote ${OUT_PATH}`,
      `  countries   ${codes.length} (+${unmatched.length} uncoded subpaths)`,
      `  fine source ${usedFine.size} small countries from 50m, rest from 110m`,
      `  rings       ${keptRings} kept, ${droppedRings} dropped as specks`,
      `  vertices    ${sourceVertices} → ${keptVertices} (${(
        (1 - keptVertices / sourceVertices) *
        100
      ).toFixed(1)}% reduction)`,
      `  module      ${(bytes / 1024).toFixed(1)} kB`,
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
