"use client";

/**
 * Pack mode — the full-screen packing space.
 *
 * The trip page is a plan: what the weather is, what you'll wear, what fits.
 * This is the act of packing. One bag at a time, filling the screen, with
 * everything you could put in it searchable down the side and everything
 * already in it orbiting the bag like a little solar system.
 *
 * The orbit is dimmed toward the far side (see lib/packing/orbit.ts) so the bag
 * stays the subject, and hovering the stage lifts the whole system a little
 * without stopping it. Each item's orbit is derived from its own id, so packing
 * or removing one leaves every other body exactly where it was.
 *
 * Positions are written straight to the DOM from one rAF loop rather than
 * through React state: twenty items re-rendering sixty times a second would
 * make the drag interaction stutter for no benefit.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BagArt } from "@/components/bag-art";
import { GearIcon } from "@/components/gear-icon";
import { Close, Search } from "@/components/icons";
import { PlaneRoute } from "@/components/plane-route";
import { thumbnailUrl } from "@/lib/image-paths";
import { itemTileImageTransform, type ItemTileMeta } from "@/lib/item-tile-meta";
import { useCutout } from "@/lib/use-cutout";
import { formatVolume, formatWeight } from "@/lib/packing/estimate";
import { occasionLabel, type OccasionKind } from "@/lib/packing/occasion";
import {
  BAG_Z,
  orbitRadii,
  phaseAt,
  planetOrbits,
  planetSlot,
  type PlanetOrbit,
} from "@/lib/packing/orbit";
import { FlyInLayer, type FlyIn } from "./fly-in-layer";
import { easeOutExpo } from "@/lib/ui-motion";
import { CapacityMeter } from "./capacity-meter";
import {
  PackingDragProvider,
  useDragHandle,
  useDropZone,
  type DragPayload,
} from "./packing-drag";

/**
 * Zone id for the rail. Dropping an orbiting piece here takes it out of the
 * bag — the exact reverse of the gesture that put it in, which beats hunting
 * for a remove button on something that's moving.
 */
export const RAIL_ZONE = "__rail__";

/** No flip, no zoom — for gear, which has no photo to frame. */
const IDENTITY_TILE: ItemTileMeta = { mirror: false, thumbZoom: 1 };

/** How long an arriving piece takes to surface in its orbit after landing. */
const REVEAL_FADE_MS = 260;

/** Anything you can put in a bag, garment or gear, flattened for the rail. */
export type PackCandidate = {
  /**
   * Thumbnail framing saved on the item — a flip or a zoom set in the item
   * editor. Optional because gear has no photo to frame.
   */
  tile?: ItemTileMeta;
  kind: "item" | "gear";
  id: string;
  name: string;
  imagePath?: string;
  icon?: string;
  /** Bucket label for the filter chips ("Tops", "Shoes", "Tech"…). */
  group: string;
  volumeLiters: number;
  weightGrams: number;
  /** Set for pieces kept out of the daily rotation. See lib/packing/occasion.ts. */
  occasion?: OccasionKind | null;
  /** The user's answer, when they've given one. Null means "use the guess". */
  dailyWearOverride?: boolean | null;
};

export type PackBag = {
  id: string;
  name: string;
  silhouette: string;
  imagePath: string | null;
  volumeLiters: number;
  maxWeightGrams: number | null;
  usedVolumeLiters: number;
  usedWeightGrams: number;
  overVolume: boolean;
  overWeight: boolean;
};

const ITEM_SIZE = 56;

export function PackMode({
  bags,
  candidates,
  contentsOf,
  activeBagId,
  onActiveBagChange,
  onDrop,
  onAdjustSize,
  onSetDailyWear,
  onAutoPack,
  onEmptyBag,
  autoPacking,
  flightId,
  flying,
  warnings,
  onClose,
}: {
  bags: PackBag[];
  /** Everything not currently in any bag. */
  candidates: PackCandidate[];
  /** What's in a given bag, in orbit order. */
  contentsOf: (bagId: string) => PackCandidate[];
  activeBagId: string;
  onActiveBagChange: (bagId: string) => void;
  /** Called on every drop: a bag id to pack, `RAIL_ZONE` to take it out. */
  onDrop: (payload: DragPayload, zoneId: string) => void;
  /** Correct a garment's estimated weight/volume. Null clears the override. */
  onAdjustSize: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
  /** Force a piece into or out of the daily rotation, or null to use the guess. */
  onSetDailyWear: (itemId: string, dailyWear: boolean | null) => void;
  /** Fill every bag automatically. Lives here because this is where the bags are. */
  onAutoPack: () => void;
  onEmptyBag: (bagId: string) => void;
  autoPacking: boolean;
  /** Bumped per press so a second press restarts the plane. */
  flightId: number;
  flying: boolean;
  /** What the last auto-pack couldn't do. */
  warnings: string[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes, and the page behind must not scroll while this is up.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const bag = bags.find((b) => b.id === activeBagId) ?? bags[0];
  const contents = bag ? contentsOf(bag.id) : [];

  /** The pack graphic, which the dropped piece flies into. */
  const packEl = useRef<HTMLDivElement | null>(null);

  /**
   * The piece currently flying in, if any.
   *
   * State rather than a ref because the overlay has to mount to be animated —
   * but it is set once per drop, not per frame, so it costs one render.
   */
  const [flight, setFlight] = useState<FlyIn | null>(null);
  const clearFlight = useCallback((key: string) => {
    setFlight((current) => (current?.key === key ? null : current));
  }, []);

  const handleDrop = useCallback(
    (payload: DragPayload, zoneId: string, point: { x: number; y: number }) => {
      // Start the flight here, synchronously, before the server request goes
      // out. This is the whole point of the overlay: the piece leaves the
      // pointer on the next frame rather than after the round trip.
      if (zoneId !== RAIL_ZONE) {
        setFlight({
          key: `${payload.kind}:${payload.id}`,
          release: point,
          imagePath: payload.imagePath ?? null,
          // Framed in flight too, so the piece doesn't flip on landing.
          tile: candidates.find((c) => c.kind === payload.kind && c.id === payload.id)?.tile,
          size: ITEM_SIZE,
        });
      }
      onDrop(payload, zoneId);
    },
    [onDrop, candidates],
  );

  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const c of candidates) if (!seen.includes(c.group)) seen.push(c.group);
    return seen;
  }, [candidates]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return candidates.filter(
      (c) =>
        (group == null || c.group === group) &&
        (needle === "" || c.name.toLowerCase().includes(needle)),
    );
  }, [candidates, query, group]);

  if (!mounted || !bag) return null;

  return createPortal(
    /*
     * The drag context lives here rather than around the whole trip page: this
     * is the only thing that drags now, and scoping it means bag ids can be
     * used as zone ids directly — there is no longer a second set of bag
     * panels mounted elsewhere to collide with.
     */
    <PackingDragProvider onDrop={handleDrop}>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: easeOutExpo }}
      role="dialog"
      aria-modal="true"
      aria-label={`Packing ${bag.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-paper"
    >
      {/* Header: which bag, and the way out. */}
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-5 py-3">
        <h2 className="font-serif text-xl">Pack</h2>
        <div className="flex flex-wrap gap-1.5">
          {bags.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onActiveBagChange(b.id)}
              aria-pressed={b.id === bag.id}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                b.id === bag.id
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
        {/* Auto-pack sat on the trip page, where it was the odd one out: a
            thing that changes the bags, in among things that only describe
            them. Here it's the shortcut past the work this screen is for.
            The plane's flight track is the flex-1 gap it leaves before Done. */}
        {/* Ruled off from the bag pills, and tinted like the tile that opens
            this screen. Sharing their shape without either made it read as a
            third bag rather than as the one control here that fills them. */}
        <span aria-hidden className="h-5 w-px bg-ink/15" />
        <button
          type="button"
          onClick={onAutoPack}
          disabled={autoPacking}
          className="rounded-full border border-accent/60 bg-accent/15 px-3.5 py-1.5 text-xs tracking-wide transition hover:bg-accent/25 disabled:opacity-50"
        >
          {autoPacking ? "Packing…" : "Auto-pack my bags"}
        </button>
        {/* Sits next to auto-pack because it is the same kind of control — one
            click that changes the whole bag — and disabled when there is
            nothing to empty, so it never looks like it did nothing. */}
        <button
          type="button"
          onClick={() => onEmptyBag(bag.id)}
          disabled={contents.length === 0}
          className="rounded-full border border-ink/15 px-3.5 py-1.5 text-xs tracking-wide transition hover:bg-paper-warm disabled:opacity-40"
        >
          Empty my bag
        </button>
        <PlaneRoute key={flightId} flying={flying} />
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-1.5 text-xs transition hover:bg-paper-warm"
        >
          <Close size={14} />
          Done
        </button>
      </header>

      {/* Auto-pack's complaints follow auto-pack. They report on the bags in
          front of you, so they belong on top of them, not on the page you
          left. */}
      {warnings.length > 0 ? (
        <ul className="space-y-1 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          {warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      ) : null}

      {/* overflow-hidden so a child that will not fit has to scroll internally
          rather than spilling past the fixed overlay, which is what put the bag
          out of reach on a phone. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* The rail you drag out of. */}
        <Rail
          query={query}
          onQuery={setQuery}
          group={group}
          onGroup={setGroup}
          groups={groups}
          shown={shown}
          total={candidates.length}
          onAdjustSize={onAdjustSize}
          onSetDailyWear={onSetDailyWear}
        />

        {/* The bag you drag into. */}
        <BagStage
          bag={bag}
          contents={contents}
          packEl={packEl}
          flyingKey={flight?.key ?? null}
          onAdjustSize={onAdjustSize}
          onSetDailyWear={onSetDailyWear}
        />
        <FlyInLayer flight={flight} targetRef={packEl} onDone={clearFlight} />
      </div>
    </motion.div>
    </PackingDragProvider>,
    document.body,
  );
}

/**
 * The searchable list you drag out of — and back into.
 *
 * A drop zone as well as a source: dragging an orbiting piece here unpacks it.
 * The alternative was a remove button on a moving target, which is a dexterity
 * test rather than an interface.
 */
function Rail({
  query,
  onQuery,
  group,
  onGroup,
  groups,
  shown,
  total,
  onAdjustSize,
  onSetDailyWear,
}: {
  query: string;
  onQuery: (q: string) => void;
  group: string | null;
  onGroup: (g: string | null) => void;
  groups: string[];
  shown: PackCandidate[];
  total: number;
  onAdjustSize: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
  onSetDailyWear: (itemId: string, dailyWear: boolean | null) => void;
}) {
  const { ref, isOver } = useDropZone(RAIL_ZONE);

  return (
    <aside
      ref={ref}
      /*
       * Height-capped on mobile, fixed-width on desktop.
       *
       * It used to be `shrink-0` at every size. In the desktop row layout that
       * is right — it is a 20rem column beside the stage. Stacked on a phone it
       * meant the rail grew to fit every row: 23 garments made it 1400px tall,
       * pushing the bag stage below the viewport of a `fixed inset-0` overlay
       * with nothing scrollable in between, so the thing you were dragging into
       * could not be reached at all. Capped at 40vh the list scrolls inside
       * itself (it already had overflow-y-auto) and the stage keeps its 18rem.
       */
      className={`flex max-h-[40vh] min-h-0 flex-col border-b transition-colors md:max-h-none md:w-80 md:shrink-0 md:border-b-0 md:border-r ${
        isOver ? "border-accent bg-accent/10" : "border-ink/10"
      }`}
    >
      <div className="space-y-2 p-4">
        <label className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
            <Search size={15} />
          </span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search your closet…"
            className="w-full rounded-xl border border-ink/15 bg-surface py-2 pl-9 pr-3 text-sm focus:border-ink/40 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={group == null} onClick={() => onGroup(null)}>
            All
          </FilterChip>
          {groups.map((g) => (
            <FilterChip key={g} active={group === g} onClick={() => onGroup(g)}>
              {g}
            </FilterChip>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
        {isOver ? (
          <li className="rounded-xl border border-dashed border-accent bg-accent/10 px-3 py-6 text-center text-xs text-ink">
            Drop to take it out of the bag
          </li>
        ) : null}
        {shown.length === 0 ? (
          <li className="rounded-xl bg-paper-warm/60 px-3 py-8 text-center text-xs text-ink-muted">
            {total === 0 ? "Everything's packed." : "Nothing matches."}
          </li>
        ) : (
          shown.map((c) => (
            <RailRow
              key={`${c.kind}:${c.id}`}
              candidate={c}
              onAdjustSize={onAdjustSize}
              onSetDailyWear={onSetDailyWear}
            />
          ))
        )}
      </ul>
    </aside>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-[11px] transition ${
        active ? "border-ink bg-ink text-paper" : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One draggable row in the rail.
 *
 * Also the home of the weight/volume override. That editor used to hang off
 * every row in the packing rail on the trip page; when that rail went, this
 * became the only place you see an item's estimated size next to a decision
 * about it, which makes it the right place to correct one.
 */
function RailRow({
  candidate,
  onAdjustSize,
  onSetDailyWear,
}: {
  candidate: PackCandidate;
  onAdjustSize: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
  onSetDailyWear: (itemId: string, dailyWear: boolean | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [grams, setGrams] = useState(String(candidate.weightGrams));
  const [liters, setLiters] = useState(String(candidate.volumeLiters));
  const payload: DragPayload = {
    kind: candidate.kind,
    id: candidate.id,
    name: candidate.name,
    imagePath: candidate.imagePath,
    icon: candidate.icon,
    volumeLiters: candidate.volumeLiters,
    weightGrams: candidate.weightGrams,
    fromZoneId: "__pool__",
  };
  const handle = useDragHandle(payload);

  return (
    <li
      className={`rounded-xl border border-ink/10 bg-surface p-2 transition-opacity ${
        handle.isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
      <span
        onPointerDown={handle.onPointerDown}
        style={handle.style}
        title={`Drag ${candidate.name} into the bag`}
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paper-warm ring-offset-2 ring-offset-paper transition hover:ring-2 hover:ring-accent/50"
      >
        {candidate.kind === "item" && candidate.imagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl(candidate.imagePath)}
            alt=""
            draggable={false}
            style={{ transform: itemTileImageTransform(candidate.tile ?? IDENTITY_TILE) }}
            className="pointer-events-none h-full w-full object-cover"
          />
        ) : (
          <GearIcon name={candidate.icon ?? "pouch"} className="pointer-events-none h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{candidate.name}</span>
        <span className="block text-[11px] text-ink-muted">
          {formatVolume(candidate.volumeLiters)} · {formatWeight(candidate.weightGrams)}
          {candidate.occasion ? ` · ${occasionLabel(candidate.occasion).toLowerCase()}` : ""}
        </span>
      </span>

      {/* Garments only: gear sizes are edited in the gear library. */}
      {candidate.kind === "item" ? (
        <button
          type="button"
          onClick={() => setEditing((o) => !o)}
          className="shrink-0 self-start text-[11px] text-ink-muted underline hover:text-ink"
        >
          {editing ? "Close" : "Adjust"}
        </button>
      ) : null}
      </div>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wide text-ink-muted">Grams</span>
            <input
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              inputMode="numeric"
              className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wide text-ink-muted">Litres</span>
            <input
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              inputMode="decimal"
              className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const w = Number(grams);
              const v = Number(liters);
              onAdjustSize(
                candidate.id,
                Number.isFinite(w) ? w : null,
                Number.isFinite(v) ? v : null,
              );
              setEditing(false);
            }}
            className="rounded-full bg-ink px-3 py-1 text-[11px] text-paper transition hover:bg-ink-soft"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              onAdjustSize(candidate.id, null, null);
              setEditing(false);
            }}
            className="text-[11px] text-ink-muted underline hover:text-ink"
          >
            Reset to estimate
          </button>

          {/*
            Whether this belongs in the day-to-day rotation. Three states, not a
            checkbox: "auto" has to stay distinguishable from a deliberate "yes",
            or correcting one garment would silently freeze the guess for it
            forever. The auto option names what the guess currently is.
          */}
          <label className="block w-full">
            <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
              Daily rotation
            </span>
            <select
              value={
                candidate.dailyWearOverride == null
                  ? "auto"
                  : candidate.dailyWearOverride
                    ? "yes"
                    : "no"
              }
              onChange={(e) =>
                onSetDailyWear(
                  candidate.id,
                  e.target.value === "auto" ? null : e.target.value === "yes",
                )
              }
              className="mt-0.5 w-full rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
            >
              <option value="auto">
                Auto —{" "}
                {candidate.occasion
                  ? `${occasionLabel(candidate.occasion).toLowerCase()}, occasion only`
                  : "everyday"}
              </option>
              <option value="yes">Wear on ordinary days</option>
              <option value="no">Occasion only</option>
            </select>
          </label>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The bag, its meters, and the orbiting contents.
 *
 * The stage is one big drop target — anywhere in the space counts, because
 * asking someone to hit a 200px bag with a dragged thumbnail is a dexterity
 * test, not an interface.
 */
function BagStage({
  bag,
  contents,
  packEl,
  flyingKey,
  onAdjustSize,
  onSetDailyWear,
}: {
  bag: PackBag;
  contents: PackCandidate[];
  /** Shared with PackMode: the pack graphic a dropped piece flies into. */
  packEl: MutableRefObject<HTMLDivElement | null>;
  /** Content key currently mid-flight, whose orbiting piece stays hidden. */
  flyingKey: string | null;
  onAdjustSize: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
  onSetDailyWear: (itemId: string, dailyWear: boolean | null) => void;
}) {
  /** Which orbiting piece has its adjust panel open, if any. */
  const [adjusting, setAdjusting] = useState<PackCandidate | null>(null);
  const reduceMotion = useReducedMotion();
  const { ref: dropRef, isOver, incoming } = useDropZone(bag.id);
  const stage = useRef<HTMLDivElement | null>(null);
  const planetRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  /** Animation clock, kept across content changes so the system never resets. */
  const elapsed = useRef(0);
  const lastFrame = useRef<number | null>(null);
  const hovering = useRef(false);
  /**
   * The piece still flying in from the pointer.
   *
   * The server confirms the pack in a few hundred milliseconds, but the flight
   * runs for two seconds — so without this the item pops into its orbit while
   * its own overlay is still in the air, and you briefly see the same garment
   * twice. Held in a ref, and read inside the rAF loop, so that changing it does
   * not tear the loop down and reset the system's angles.
   */
  const flyingKeyRef = useRef<string | null>(null);
  const previousFlyingKey = useRef<string | null>(null);
  /**
   * When each arriving piece became visible, so it can fade in rather than pop.
   *
   * The flight ends at the centre of the pack, but the piece's orbit slot is out
   * on the ellipse — so revealing it at full opacity the instant the flight lands
   * would snap it from the pack to its orbit. A short fade covers that gap: the
   * flight disappears into the pack and the piece surfaces in its orbit.
   */
  const revealedAt = useRef(new Map<string, number>());
  flyingKeyRef.current = flyingKey;
  // Keep both refs: one for the drop-zone registry, one to measure the stage.
  const setStage = useCallback(
    (el: HTMLDivElement | null) => {
      stage.current = el;
      dropRef(el);
    },
    [dropRef],
  );

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Keyed by item, not by position: `orbitFor` derives an orbit from the key
   * alone, so packing or removing something leaves every other body untouched.
   * Joined into a string for the dependency list — the array identity changes
   * on every render, the contents don't.
   */
  const contentKeys = contents.map((c) => `${c.kind}:${c.id}`);
  const keySignature = contentKeys.join("|");
  const orbits: PlanetOrbit[] = useMemo(() => {
    const { maxRadiusX, maxRadiusY } = orbitRadii({
      width: box.width,
      height: box.height,
      itemHalf: ITEM_SIZE / 2,
    });
    return planetOrbits(keySignature ? keySignature.split("|") : [], {
      maxRadiusX,
      maxRadiusY,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, box.width, box.height]);

  /**
   * One rAF loop writes every planet's transform.
   *
   * The clock lives in a ref, not a local. This effect re-runs whenever the
   * contents change, and an `elapsed` scoped to it would reset to zero on every
   * pack and unpack — snapping the entire system back to its start angles,
   * which is the most disruptive thing adding an item could possibly do.
   *
   * Hover is read from a ref for the same reason: it only changes brightness,
   * and putting it in the dependency list would tear down and rebuild the loop
   * every time the pointer crossed the stage.
   */
  useEffect(() => {
    if (orbits.length === 0) return;
    let raf = 0;

    const frame = (now: number) => {
      if (lastFrame.current == null) lastFrame.current = now;
      const dt = now - lastFrame.current;
      lastFrame.current = now;
      if (!reduceMotion) elapsed.current += dt;

      // The frame a flight ends is the frame its piece starts fading in.
      if (previousFlyingKey.current && previousFlyingKey.current !== flyingKeyRef.current) {
        revealedAt.current.set(previousFlyingKey.current, now);
      }
      previousFlyingKey.current = flyingKeyRef.current;
      const phase = phaseAt(elapsed.current);
      const lift = hovering.current;

      for (let i = 0; i < orbits.length; i += 1) {
        const node = planetRefs.current[i];
        if (!node) continue;
        // Arrivals are handled by FlyInLayer, which flies the piece in from the
        // pointer in viewport space. Planets themselves only ever hold their
        // steady orbit, which is why this loop has no special cases left.
        const slot = planetSlot(orbits[i], phase);
        node.style.transform = `translate3d(${slot.x.toFixed(1)}px, ${slot.y.toFixed(1)}px, 0) scale(${slot.scale.toFixed(3)})`;
        // Still in the air: keep its orbiting copy invisible so the flight is
        // the only version of the piece on screen. It keeps its transform, so it
        // is already in the right place the moment it is revealed.
        const key = contentKeys[i];
        const arriving = key === flyingKeyRef.current;
        const revealStart = key === undefined ? undefined : revealedAt.current.get(key);
        const fade =
          revealStart === undefined
            ? 1
            : Math.min(1, (now - revealStart) / REVEAL_FADE_MS);
        if (fade >= 1 && revealStart !== undefined) revealedAt.current.delete(key!);

        const settled = lift ? Math.min(1, slot.opacity + 0.15) : slot.opacity;
        node.style.opacity = arriving ? "0" : String(settled * fade);
        node.style.zIndex = String(slot.zIndex);
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      // Drop the timestamp so the next loop doesn't count the gap as elapsed.
      lastFrame.current = null;
    };
  }, [orbits, reduceMotion]);

  const fill = bag.volumeLiters > 0 ? bag.usedVolumeLiters / bag.volumeLiters : 0;
  const bagCutout = useCutout(bag.imagePath);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={setStage}
        onPointerEnter={() => {
          hovering.current = true;
        }}
        onPointerLeave={() => {
          hovering.current = false;
        }}
        className={`relative flex min-h-[18rem] flex-1 items-center justify-center overflow-hidden transition-colors ${
          isOver ? "bg-accent/10" : ""
        }`}
      >
        {/* Faint guide rings, so the system reads as orbits rather than as
            thumbnails drifting at random. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full text-ink"
          style={{ opacity: 0.06 }}
        >
          {orbits.map((o, i) => (
            <ellipse
              key={i}
              cx="50%"
              cy="50%"
              rx={o.radiusX}
              ry={o.radiusY}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
            />
          ))}
        </svg>

        {/* The bag itself, and the point a dropped piece flies into. */}
        <div
          ref={packEl}
          className="relative flex flex-col items-center"
          style={{ zIndex: BAG_Z }}
        >
          {/* The bag's own photo gets the same treatment as the items — an
              uploaded pack shot is usually on the same white or black sweep,
              and once the orbit is cut out the bag is the only opaque
              rectangle left on screen. Falls back to the drawn silhouette
              until the cut-out resolves, so nothing pops in as a black box. */}
          {bag.imagePath && bagCutout ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bagCutout}
              alt={bag.name}
              draggable={false}
              className="h-48 w-48 object-contain"
            />
          ) : (
            <BagArt
              silhouette={bag.silhouette}
              level={fill}
              over={bag.overVolume}
              className="h-48 w-48 text-ink"
            />
          )}
          {/* Clear of the artwork: a cut-out fills its box to the edge, so the
              4px this used to have put the caption against the bag. */}
          <p className="mt-3 text-xs text-ink-muted">
            {contents.length} {contents.length === 1 ? "thing" : "things"} in {bag.name}
          </p>
        </div>

        {/* The planets. No plate, no border, no shadow — the garments are cut
            out of their backdrops so they read as objects in space rather than
            as photographs pinned to tiles. */}
        {contents.map((entry, i) => (
          <Planet
            key={`${entry.kind}:${entry.id}`}
            entry={entry}
            bagId={bag.id}
            innerRef={(el) => {
              planetRefs.current[i] = el;
            }}
            onOpen={() => setAdjusting(entry)}
          />
        ))}

        <AnimatePresence>
          {isOver ? (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute bottom-4 rounded-full bg-ink px-4 py-1.5 text-xs text-paper"
              style={{ zIndex: BAG_Z + 60 }}
            >
              Drop to pack
            </motion.p>
          ) : null}
        </AnimatePresence>

        {contents.length === 0 && !isOver ? (
          <p className="pointer-events-none absolute bottom-4 text-xs text-ink-muted">
            Drag something over from the left.
          </p>
        ) : null}

        {adjusting ? (
          <PlanetAdjust
            entry={adjusting}
            onAdjustSize={onAdjustSize}
            onSetDailyWear={onSetDailyWear}
            onClose={() => setAdjusting(null)}
          />
        ) : null}
      </div>

      {/* Meters, previewing whatever is being dragged over the stage. */}
      <div className="space-y-3 border-t border-ink/10 px-5 py-4">
        <CapacityMeter
          label="Volume"
          used={bag.usedVolumeLiters}
          capacity={bag.volumeLiters}
          incoming={incoming?.volumeLiters ?? null}
          format={formatVolume}
          over={bag.overVolume}
        />
        {bag.maxWeightGrams != null ? (
          <CapacityMeter
            label="Weight"
            used={bag.usedWeightGrams}
            capacity={bag.maxWeightGrams}
            incoming={incoming?.weightGrams ?? null}
            format={formatWeight}
            over={bag.overWeight}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One orbiting item.
 *
 * Its own component so each can resolve its cut-out independently — twenty
 * images finishing at twenty different moments would otherwise re-render the
 * whole stage twenty times, and the stage owns the animation loop.
 *
 * Both a drag handle and a button. The drag threshold in `packing-drag.tsx` is
 * what lets those coexist: a press that doesn't move is a click and opens the
 * adjust panel, a press that moves picks the piece up. Dragging it to the rail
 * takes it out of the bag.
 *
 * The image is `object-contain`: a cut-out cropped to fill would slice the
 * shoulders off a jacket, and there's no tile edge left to justify the crop.
 */
function Planet({
  entry,
  bagId,
  innerRef,
  onOpen,
}: {
  entry: PackCandidate;
  bagId: string;
  innerRef: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const cutout = useCutout(entry.kind === "item" ? entry.imagePath : null);
  const handle = useDragHandle({
    kind: entry.kind,
    id: entry.id,
    name: entry.name,
    imagePath: entry.imagePath,
    icon: entry.icon,
    volumeLiters: entry.volumeLiters,
    weightGrams: entry.weightGrams,
    fromZoneId: bagId,
  });

  return (
    <button
      ref={innerRef}
      type="button"
      onPointerDown={handle.onPointerDown}
      onClick={onOpen}
      title={`${entry.name} — click to adjust, drag to the list to take out`}
      style={{ width: ITEM_SIZE, height: ITEM_SIZE, zIndex: BAG_Z, touchAction: "none" }}
      className={`absolute flex cursor-grab items-center justify-center rounded-xl transition-transform hover:scale-110 ${
        handle.isDragging ? "opacity-30" : ""
      }`}
    >
      {entry.kind === "item" ? (
        cutout ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cutout}
            alt={entry.name}
            draggable={false}
            // Same framing the closet grid applies, so a piece you flipped or
            // zoomed looks the same here as where you edited it.
            style={{ transform: itemTileImageTransform(entry.tile ?? IDENTITY_TILE) }}
            className="pointer-events-none h-full w-full object-contain drop-shadow-sm"
          />
        ) : (
          // Nothing until the cut-out is ready; the alternative is a flash of
          // white squares every time Pack mode opens.
          <span className="h-full w-full rounded-xl bg-ink/5" />
        )
      ) : (
        <GearIcon name={entry.icon ?? "pouch"} className="pointer-events-none h-7 w-7 text-ink" />
      )}
    </button>
  );
}

/**
 * The panel a click on an orbiting piece opens.
 *
 * Same two controls as the rail row — size and daily rotation — because they're
 * the same two questions, and a piece already in the bag is exactly when you
 * notice its weight is wrong.
 */
function PlanetAdjust({
  entry,
  onAdjustSize,
  onSetDailyWear,
  onClose,
}: {
  entry: PackCandidate;
  onAdjustSize: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
  onSetDailyWear: (itemId: string, dailyWear: boolean | null) => void;
  onClose: () => void;
}) {
  const [grams, setGrams] = useState(String(entry.weightGrams));
  const [liters, setLiters] = useState(String(entry.volumeLiters));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    // Capture, so Escape closes this before Pack mode sees it and closes both.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      {/* Click-away. Sits under the panel and over everything else. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ zIndex: BAG_Z + 90 }}
        className="absolute inset-0 cursor-default bg-paper/40"
      />
      <div
        style={{ zIndex: BAG_Z + 91 }}
        className="absolute bottom-4 left-1/2 w-[19rem] -translate-x-1/2 rounded-2xl border border-ink/15 bg-paper p-4 shadow-tile"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm">{entry.name}</span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[11px] text-ink-muted underline hover:text-ink"
          >
            Close
          </button>
        </div>

        {entry.kind === "item" ? (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
                  Grams
                </span>
                <input
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  inputMode="numeric"
                  className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
                  Litres
                </span>
                <input
                  value={liters}
                  onChange={(e) => setLiters(e.target.value)}
                  inputMode="decimal"
                  className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const w = Number(grams);
                  const v = Number(liters);
                  onAdjustSize(entry.id, Number.isFinite(w) ? w : null, Number.isFinite(v) ? v : null);
                  onClose();
                }}
                className="rounded-full bg-ink px-3 py-1 text-[11px] text-paper transition hover:bg-ink-soft"
              >
                Save
              </button>
            </div>

            <label className="mt-3 block">
              <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
                Daily rotation
              </span>
              <select
                value={
                  entry.dailyWearOverride == null ? "auto" : entry.dailyWearOverride ? "yes" : "no"
                }
                onChange={(e) =>
                  onSetDailyWear(
                    entry.id,
                    e.target.value === "auto" ? null : e.target.value === "yes",
                  )
                }
                className="mt-0.5 w-full rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
              >
                <option value="auto">
                  Auto —{" "}
                  {entry.occasion
                    ? `${occasionLabel(entry.occasion).toLowerCase()}, occasion only`
                    : "everyday"}
                </option>
                <option value="yes">Wear on ordinary days</option>
                <option value="no">Occasion only</option>
              </select>
            </label>
          </>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">
            Gear sizes are edited in the gear library.
          </p>
        )}

        <p className="mt-3 text-[11px] text-ink-muted">
          Drag it onto the list to take it out of the bag.
        </p>
      </div>
    </>
  );
}
