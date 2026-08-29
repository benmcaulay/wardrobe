"use client";

/**
 * The closet as one rod.
 *
 * The grid's job is to let you find a garment. This one's job is to let you see
 * the shape of the closet: hangers sit along a time axis by when the piece was
 * last worn, so what you wear crowds the near end and what you don't sits alone
 * with empty rod either side.
 *
 * All the arithmetic is in lib/space/rail.ts, which is pure and tested. This
 * file only turns offsets into `left:` percentages, and it observes the same
 * restraint the module does: it labels how long the empty stretches are and how
 * many pieces have never been worn, and it does not say a single word about
 * what to do next. See lenses-client.tsx for why that line exists and why
 * nothing here may cross it.
 *
 * `nowMs` is a prop rather than a `Date.now()` call: this renders inside a
 * server-rendered tree, and reading the clock during render would give the
 * server and the client different axes and hydrate as every hanger jumping.
 */

import Link from "next/link";
import { useMemo } from "react";
import { formatLastWorn, formatRailGap, layOutRail } from "@/lib/space/rail";
import { thumbnailUrl } from "@/lib/image-paths";
import { itemTileImageTransform } from "@/lib/item-tile-meta";

export type RailViewItem = {
  id: string;
  name: string;
  imagePath: string;
  thumbZoom: number;
  mirror: boolean;
  lastWornAtMs: number | null;
};

/** px. Tile edge, and therefore the rhythm everything else is derived from. */
const TILE = 52;
/** px between the rod and the first row of tiles. */
const STEM = 14;
/** px from one lane's tile top to the next. */
const LANE_H = TILE + 12;
/** px from the top of the box to the rod. Leaves room for the axis caption. */
const ROD_Y = 22;
/** px reserved under the last lane for the gap captions. */
const CAPTION_H = 34;
/**
 * px each hanger is nudged right per `stack`.
 *
 * Once the lanes are full, extra hangers land on the same spot — a closet with
 * a dozen never-worn pieces drew four tiles and hid eight behind them. This
 * fans the pile so every garment is at least a sliver visible. Presentation
 * only: `offset` is untouched, so nothing here claims a wear date the piece
 * doesn't have.
 */
const FAN_PX = 9;
/**
 * Most fan steps a pile gets.
 *
 * The fan has to be bounded, because the pile isn't: without a cap, a closet
 * with sixty never-worn pieces fans them straight off the end of the rod, and
 * the reserved padding below would have to grow with the data. Past this the
 * extras land on the last step — the exact count is stated in words under the
 * rod anyway, so the picture only has to say "several", not "fifteen".
 */
const FAN_MAX_STEPS = 3;

export function ClosetRail({ items, nowMs }: { items: RailViewItem[]; nowMs: number }) {
  const layout = useMemo(
    () => layOutRail(items, nowMs),
    [items, nowMs],
  );
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center">
        <p className="font-serif text-xl">Nothing to hang.</p>
      </div>
    );
  }

  const height = ROD_Y + STEM + layout.lanes * LANE_H + CAPTION_H;
  const datedCount = layout.hangers.length - layout.neverWornCount;

  return (
    <div className="space-y-3">
      {/* The axis, stated in words. Without it the rod is a decorative row of
          thumbnails and the spacing means nothing. */}
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.14em] text-ink-muted">
        <span>Worn most recently</span>
        <span>{layout.neverWornCount > 0 ? "Never worn" : "Longest ago"}</span>
      </div>

      <div className="overflow-x-auto pb-1">
        {/*
          min-width keeps the axis readable on a phone by letting the rod scroll
          instead of compressing every gap out of existence — the gaps are the
          content.

          Padding is asymmetric: half a tile on the left so a hanger at offset 0
          isn't clipped, and half a tile *plus the whole fan budget* on the
          right, because offset 1 is where every never-worn piece piles up.
        */}
        <div
          className="relative min-w-[42rem]"
          style={{
            height,
            paddingLeft: TILE / 2,
            paddingRight: TILE / 2 + FAN_MAX_STEPS * FAN_PX,
          }}
        >
          <div className="relative h-full w-full">
            {/* The rod. */}
            <div
              aria-hidden
              className="absolute inset-x-0 h-[3px] rounded-full bg-ink/25"
              style={{ top: ROD_Y }}
            />

            {layout.hangers.map((hanger) => {
              const item = byId.get(hanger.id);
              if (!item) return null;
              const top = ROD_Y + STEM + hanger.lane * LANE_H;
              return (
                <div
                  key={hanger.id}
                  className="absolute"
                  style={{
                    left: `${hanger.offset * 100}%`,
                    top: ROD_Y,
                    // Later arrivals sit in front, so the fan reads front-to-back.
                    zIndex: hanger.stack,
                  }}
                >
                  <div
                    className="-translate-x-1/2"
                    style={
                      hanger.stack > 0
                        ? {
                            transform: `translateX(calc(-50% + ${
                              Math.min(hanger.stack, FAN_MAX_STEPS) * FAN_PX
                            }px))`,
                          }
                        : undefined
                    }
                  >
                    {/* The stem, drawn from the rod down to this lane's tile, so
                        a hanger in lane 3 still visibly hangs off the rod. */}
                    <div
                      aria-hidden
                      className="mx-auto w-px bg-ink/25"
                      style={{ height: top - ROD_Y }}
                    />
                    <Link
                      href={`/closet/${item.id}`}
                      title={`${item.name} — ${formatLastWorn(hanger.daysSince)}`}
                      className="block overflow-hidden rounded-xl bg-surface shadow-tile ring-1 ring-ink/5 transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      style={{ width: TILE, height: TILE }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnailUrl(item.imagePath)}
                        alt={item.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        style={{
                          transform: itemTileImageTransform({
                            thumbZoom: item.thumbZoom,
                            mirror: item.mirror,
                          }),
                        }}
                      />
                    </Link>
                  </div>
                </div>
              );
            })}

            {/*
              Gap captions, centred under each empty stretch. Rendered last so
              they sit above the stems, and pointer-events-none so they never
              swallow a click meant for a hanger beside them.
            */}
            {layout.gaps.map((gap) => (
              <div
                key={`${gap.fromOffset}-${gap.toOffset}`}
                className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-center text-[11px] text-ink-muted"
                style={{
                  left: `${((gap.fromOffset + gap.toOffset) / 2) * 100}%`,
                  top: height - CAPTION_H + 8,
                }}
              >
                <span className="rounded-full bg-paper-warm px-2 py-0.5">
                  {formatRailGap(gap)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {layout.neverWornCount > 0 ? (
        <p className="text-xs text-ink-muted">
          {layout.neverWornCount}{" "}
          {layout.neverWornCount === 1 ? "piece has" : "pieces have"} no wear logged, so{" "}
          {layout.neverWornCount === 1 ? "it hangs" : "they hang"} at the far end.
        </p>
      ) : null}
      {/*
        Three states, not two. `spanDays === 0` covers both "everything was worn
        the same day" and "nothing has ever been worn", and on a closet with no
        wear history at all the second reading made the first sentence a lie
        about pieces that don't exist. When nothing is dated, the never-worn line
        above has already said everything true there is to say.
      */}
      {layout.spanDays > 0 ? (
        <p className="text-xs text-ink-muted">
          The rod spans {formatSpan(layout.spanDays)}, near end to far.
        </p>
      ) : datedCount > 0 ? (
        <p className="text-xs text-ink-muted">
          Every piece with a wear logged was worn on the same day, so the rod has no span yet.
        </p>
      ) : null}
    </div>
  );
}

function formatSpan(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}
