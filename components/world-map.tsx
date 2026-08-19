"use client";

/**
 * The little map window on the trip page.
 *
 * Draws the baked Natural Earth outlines from `lib/packing/world-map-data.ts`,
 * highlights the destination's country, and drops a pin on the city. No tiles,
 * no token, no network — see `scripts/build-world-map.ts` for why.
 *
 * Zooming is done by transforming a group rather than by animating the SVG
 * `viewBox`, which is an attribute and so isn't transitionable. The viewBox is
 * pinned to the world view; `zoomTransform` maps whichever viewport we want
 * onto it. That gets a genuine eased zoom for one CSS transition, and inherits
 * the app's prefers-reduced-motion rule in globals.css for free.
 */

import { useMemo, useState } from "react";
import {
  MAP_ASPECT_RATIO,
  placeOnViewport,
  project,
  regionViewport,
  unitScale,
  viewBoxOf,
  worldViewport,
  zoomTransform,
} from "@/lib/packing/world-map";
import {
  WORLD_COUNTRIES,
  WORLD_HEIGHT,
  WORLD_UNCODED_LAND,
  WORLD_WIDTH,
} from "@/lib/packing/world-map-data";

/** Graticule spacing in degrees. Sparse enough to read as a grid, not a net. */
const GRATICULE_STEP = 15;

/**
 * Every country plus the uncoded land, as one path. Concatenating ~58kB of
 * strings is cheap but not free, and it never changes — so it happens once at
 * module load rather than on each render.
 */
const ALL_LAND = `${Object.values(WORLD_COUNTRIES).join("")}${WORLD_UNCODED_LAND}`;

export type WorldMapProps = {
  latitude: number | null;
  longitude: number | null;
  /** ISO 3166-1 alpha-2. Fills the matching country; unknown codes are ignored. */
  countryCode?: string | null;
  /** Shown in the corner plate, e.g. "Seoul, South Korea". */
  label?: string | null;
  className?: string;
};

/** Meridians and parallels across the whole canvas, as one path. */
function graticulePath(): string {
  const parts: string[] = [];
  for (let lon = -180 + GRATICULE_STEP; lon < 180; lon += GRATICULE_STEP) {
    const { x } = project(lon, 0);
    parts.push(`M${x} 0V${WORLD_HEIGHT}`);
  }
  for (let lat = -90 + GRATICULE_STEP; lat < 90; lat += GRATICULE_STEP) {
    const { y } = project(0, lat);
    parts.push(`M0 ${y}H${WORLD_WIDTH}`);
  }
  return parts.join("");
}

export function WorldMap({ latitude, longitude, countryCode, label, className }: WorldMapProps) {
  const hasPoint = latitude != null && longitude != null;
  const [zoomedOut, setZoomedOut] = useState(false);

  const world = useMemo(() => worldViewport(), []);
  const graticule = useMemo(() => graticulePath(), []);

  // Without coordinates there is nothing to zoom to, so the toggle is hidden
  // and the world view is all there is.
  const showWorld = zoomedOut || !hasPoint;
  const target = useMemo(
    () => (showWorld ? world : regionViewport({ latitude: latitude!, longitude: longitude! })),
    [showWorld, world, latitude, longitude],
  );

  const highlight = countryCode ? WORLD_COUNTRIES[countryCode.toUpperCase()] : undefined;

  // The pin lives outside the zoomed group so its size is fixed in screen
  // terms; that means placing it by hand in the outer coordinate space.
  const pin = useMemo(
    () =>
      hasPoint
        ? placeOnViewport({ latitude: latitude!, longitude: longitude! }, world, target)
        : null,
    [hasPoint, latitude, longitude, target, world],
  );

  // Hold the coastline hairline at a constant on-screen weight as we zoom in.
  const stroke = 0.5 / unitScale(target);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-ink/10 bg-paper-warm ${
        className ?? ""
      }`}
      style={{ aspectRatio: String(MAP_ASPECT_RATIO) }}
    >
      {/* Tone is carried by SVG's own fill-opacity/stroke-opacity attributes
          rather than Tailwind classes: land needs a fill and a stroke at
          different opacities on one element, which is two attributes here and
          two utilities plus an arbitrary value there. currentColor still
          tracks the theme, so the map inverts correctly in dark mode. */}
      <svg
        viewBox={viewBoxOf(world)}
        className="block h-full w-full text-ink"
        role="img"
        aria-label={label ? `Map showing ${label}` : "World map"}
      >
        <g
          style={{
            transform: zoomTransform(world, target),
            // Stated rather than inherited: `zoomTransform` is derived for an
            // origin at user-space (0,0), and a browser defaulting elsewhere
            // would slide the whole map off the pin.
            transformBox: "view-box",
            transformOrigin: "0 0",
            transition: "transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          <path
            d={graticule}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.09}
            strokeWidth={stroke}
          />
          <path
            d={ALL_LAND}
            fill="currentColor"
            fillOpacity={0.1}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
          {highlight ? (
            <path
              d={highlight}
              className="text-accent"
              fill="currentColor"
              fillOpacity={0.55}
              stroke="currentColor"
              strokeWidth={stroke * 1.5}
              strokeLinejoin="round"
            />
          ) : null}
        </g>

        {pin ? (
          <g
            className="text-ink"
            style={{
              transform: `translate(${pin.x}px, ${pin.y}px)`,
              transition: "transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1)",
            }}
          >
            {/* Crosshair: four ticks stopping short of the dot, so the pin
                reads as a coordinate rather than a blob at this size. */}
            <path
              d="M0 -9V-4M0 4V9M-9 0H-4M4 0H9"
              stroke="currentColor"
              strokeWidth={0.7}
              strokeLinecap="round"
              className="opacity-40"
            />
            <circle r={4.2} className="fill-paper" />
            <circle r={4.2} stroke="currentColor" strokeWidth={0.8} fill="none" />
            <circle r={2} className="fill-accent" />
          </g>
        ) : null}
      </svg>

      {label ? (
        <div className="pointer-events-none absolute bottom-2 left-2.5 max-w-[70%] truncate rounded-full bg-paper/85 px-2.5 py-1 text-[11px] text-ink backdrop-blur-sm">
          {label}
        </div>
      ) : null}

      {hasPoint ? (
        <button
          type="button"
          onClick={() => setZoomedOut((o) => !o)}
          className="absolute right-2 top-2 rounded-full bg-paper/85 px-2.5 py-1 text-[11px] text-ink-muted backdrop-blur-sm transition hover:text-ink"
        >
          {zoomedOut ? "Zoom in" : "Whole world"}
        </button>
      ) : null}
    </div>
  );
}
