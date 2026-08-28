"use client";

/**
 * The looks carousel.
 *
 * Every day of the trip on one ring, seen from the front: the look at the near
 * point is upright and full strength, the rest recede round the ellipse getting
 * smaller and fainter. Moving the cursor left or right of centre spins it —
 * further out, faster — with a dead zone in the middle so settling on a look
 * doesn't require holding still.
 *
 * Two shared modules do the thinking. `lib/packing/carousel.ts` owns the ring:
 * where each slide sits, the depth cues, and the pointer-to-spin mapping.
 * `lib/packing/look.ts` composes each individual outfit using the outfits tab's
 * own placement rules, so a look reads the same here as it does there.
 *
 * Positions are written straight to the DOM from one rAF loop. React only hears
 * about the ring when the *front* slide changes, which is a few times a spin
 * rather than sixty times a second.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { Close } from "@/components/icons";
import { useCutout } from "@/lib/use-cutout";
import { itemTileTransformSuffix, type ItemTileMeta } from "@/lib/item-tile-meta";
import {
  carouselRadius,
  carouselSlot,
  frontIndex,
  phaseForIndex,
  shortestPhaseDelta,
  spinVelocity,
  wrapPhase,
} from "@/lib/packing/carousel";
import {
  LOOK_FRAME_HEIGHT,
  LOOK_FRAME_WIDTH,
  composeLook,
  lookBounds,
  type LookLayoutPrefs,
  type PlacedPiece,
} from "@/lib/packing/look";
import { easeOutExpo } from "@/lib/ui-motion";

/**
 * On-canvas size of a piece before its own scale. Matches the outfit canvas's
 * piece box, so a saved scale means the same thing in both places.
 */
const PIECE_SIZE = 200;

/** Logical size of one slide. The look is fitted into this. */
const SLIDE_WIDTH = 340;
const SLIDE_HEIGHT = 460;

/** How fast a click-to-select glides the ring round, in turns per second. */
const SNAP_TURNS_PER_SECOND = 1.1;

/** How much the focused look grows over its ring size. */
const FOCUS_SCALE = 1.22;
/** How far the rest of the ring recedes while one look is focused. */
const FOCUS_DIM = 0.35;
/** Pointer travel, in px, that turns the ring one full revolution. */
const DRAG_PX_PER_TURN = 900;
/** Movement past this counts as a drag rather than a click. */
const DRAG_SLOP_PX = 4;

export type LookDay = {
  /** 1-based day number. */
  day: number;
  label: string;
  complete: boolean;
  rewear: boolean;
  /** "Beach", "Formal event"… when the day belongs to an activity. */
  activity?: string | null;
  pieces: {
    id: string;
    category: string;
    imagePath: string;
    name: string;
    /** Flip and zoom saved on the item, applied so looks match the closet. */
    tile?: ItemTileMeta;
  }[];
};

export function LooksCarousel({
  days,
  prefs,
  initialDay = 0,
  onClose,
  onEditLook,
}: {
  days: LookDay[];
  prefs: LookLayoutPrefs;
  initialDay?: number;
  onClose: () => void;
  /** Open this look in the outfit composer. Given the day's piece ids. */
  onEditLook?: (day: LookDay) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const count = days.length;
  const stage = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** Kept alongside so the loop can fade labels without querying the DOM. */
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /** Live ring state. In refs because the rAF loop owns it, not React. */
  const phase = useRef(phaseForIndex(Math.min(Math.max(0, initialDay), Math.max(0, count - 1)), count));
  const pointerX = useRef<number | null>(null);
  const target = useRef<number | null>(null);
  /**
   * Set when a slide is picked, cleared once the pointer returns to the dead
   * zone. Without it a click is pointless: reaching a side slide puts your
   * cursor off-centre, and the very next mouse move would spin the selection
   * straight back off the front.
   */
  const holdUntilCentred = useRef(false);
  const [front, setFront] = useState(() => frontIndex(phase.current, count));
  /**
   * The look you have clicked into, if any.
   *
   * Focus is a separate idea from "front". Spinning brings a look to the front;
   * clicking it says you want to look at *that one*, which stops the ring
   * responding to the pointer and gives the look somewhere to put its own
   * controls. Clicking anywhere off a slide lets go again.
   */
  const [focused, setFocused] = useState<number | null>(null);

  /**
   * Live drag state, in a ref because the rAF loop reads it every frame.
   *
   * Dragging exists because pointer-position spinning is hard to aim: the ring
   * moves whenever the cursor moves, so there is no way to hold a position or
   * to nudge by a known amount. A drag is a direct grip — the ring turns by how
   * far you moved and stops when you let go.
   */
  const drag = useRef<{
    pointerId: number;
    lastX: number;
    moved: boolean;
    /**
     * Which look the press started on, or null for the backdrop.
     *
     * Read from the pointerdown target and remembered, because the ring
     * captures the pointer: from that moment every later event for this pointer
     * retargets to the ring, so a slide's own pointerup never fires and the
     * press target is the only record of what was actually pressed.
     */
    downIndex: number | null;
  } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const measure = useCallback((el: HTMLDivElement | null) => {
    stage.current = el;
    if (!el) return;
    const update = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
  }, []);

  /** Glide to a slide rather than jumping, taking the short way round. */
  const spinTo = useCallback(
    (index: number) => {
      target.current = phaseForIndex(index, count);
      holdUntilCentred.current = true;
    },
    [count],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape backs out one level: focus first, then the carousel.
      if (e.key === "Escape") {
        if (focusedRef.current != null) setFocused(null);
        else onClose();
      }
      if (e.key === "ArrowRight") spinTo((frontIndex(phase.current, count) + 1) % count);
      if (e.key === "ArrowLeft") spinTo((frontIndex(phase.current, count) - 1 + count) % count);
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, spinTo, count]);

  /** Focus mirrored into a ref, so changing it does not restart the rAF loop. */
  const focusedRef = useRef<number | null>(null);
  focusedRef.current = focused;

  const radius = carouselRadius({ width: box.width || 1, slideWidth: SLIDE_WIDTH });

  /**
   * The one loop. Advances the phase — either gliding toward a clicked slide or
   * following the pointer — and writes every slide's transform.
   */
  useEffect(() => {
    if (count === 0 || box.width === 0) return;
    let raf = 0;
    let last: number | null = null;

    const frame = (now: number) => {
      if (last == null) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (target.current != null) {
        const remaining = shortestPhaseDelta(phase.current, target.current);
        const step = SNAP_TURNS_PER_SECOND * dt;
        if (reduceMotion || Math.abs(remaining) <= step) {
          phase.current = target.current;
          target.current = null;
        } else {
          phase.current = wrapPhase(phase.current + Math.sign(remaining) * step);
        }
      } else if (drag.current != null) {
        // Dragging owns the ring outright; the phase is advanced in the pointer
        // handler where the delta is known, so there is nothing to do per frame.
      } else if (focusedRef.current != null) {
        // Focused: the ring holds still. Following the pointer here would spin
        // the thing you just asked to look at off the front.
      } else if (pointerX.current != null && !reduceMotion) {
        const velocity = spinVelocity(pointerX.current, box.width);
        // A pick holds until you bring the cursor back to the middle.
        if (holdUntilCentred.current) {
          if (velocity === 0) holdUntilCentred.current = false;
        } else {
          phase.current = wrapPhase(phase.current + velocity * dt);
        }
      }

      for (let i = 0; i < count; i += 1) {
        const node = slideRefs.current[i];
        if (!node) continue;
        const slot = carouselSlot(i, count, { radiusX: radius, radiusY: 26, phase: phase.current });
        const isFocused = focusedRef.current === i;
        // The focused look grows and everything else recedes, so the ring reads
        // as "one of these, chosen" rather than just "one of these, nearest".
        const scale = isFocused ? slot.scale * FOCUS_SCALE : slot.scale;
        const dim = focusedRef.current != null && !isFocused ? FOCUS_DIM : 1;
        node.style.transform = `translate3d(${slot.x.toFixed(1)}px, ${slot.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        node.style.opacity = (slot.opacity * dim).toFixed(3);
        node.style.zIndex = String(slot.zIndex);
        /*
         * The whole near side is clickable, not just the front slide — picking
         * a look you can see is the "select" half of the carousel. Anything
         * past the sides is behind something else and would steal the click.
         */
        node.style.pointerEvents = slot.depth > 0.15 ? "auto" : "none";

        /*
         * Labels fade out much faster than their slides. The looks themselves
         * overlap happily — that's what makes it a ring — but eleven date
         * captions stacked at the back turn into an unreadable smear.
         */
        const label = labelRefs.current[i];
        if (label) {
          label.style.opacity = String(Math.max(0, (slot.depth - 0.45) / 0.55));
        }
      }

      const nowFront = frontIndex(phase.current, count);
      setFront((prev) => (prev === nowFront ? prev : nowFront));

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      last = null;
    };
  }, [count, radius, box.width, reduceMotion]);

  if (!mounted || count === 0) return null;
  const current = days[Math.min(front, count - 1)];

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: easeOutExpo }}
      role="dialog"
      aria-modal="true"
      aria-label="Looks, day by day"
      className="fixed inset-0 z-50 flex flex-col bg-paper"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-5 py-3">
        <h2 className="font-serif text-xl">Looks</h2>
        <span className="text-xs text-ink-muted">
          Day {current.day} of {count} · {current.label}
          {current.activity ? ` · ${current.activity}` : ""}
          {current.rewear ? " · re-wear" : ""}
          {!current.complete ? " · nothing to wear" : ""}
        </span>
        <span className="ml-auto hidden text-[11px] text-ink-muted sm:block">
          {focused != null ? "Click away to unfocus" : "Drag to spin · click a look to focus"}
        </span>
        {/* Only offered while focused: "edit this look" is meaningless without
            a look chosen, and it lives in the header rather than on the slide so
            it is not a drag target. */}
        {focused != null && onEditLook ? (
          <button
            type="button"
            onClick={() => onEditLook(days[Math.min(focused, count - 1)])}
            className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-xs transition hover:bg-paper-warm"
          >
            Edit this look
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-1.5 text-xs transition hover:bg-paper-warm"
        >
          <Close size={14} />
          Done
        </button>
      </header>

      {/* The ring. Pointer position anywhere over this drives the spin. */}
      <div
        ref={measure}
        onPointerDown={(e) => {
          // Grab the ring. Captured so the drag survives the pointer leaving
          // the element, and guarded because setPointerCapture throws for a
          // pointer id the element never saw.
          const slide = (e.target as Element | null)?.closest?.("[data-look-index]");
          const attr = slide?.getAttribute("data-look-index");
          drag.current = {
            pointerId: e.pointerId,
            lastX: e.clientX,
            moved: false,
            downIndex: attr == null ? null : Number.parseInt(attr, 10),
          };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* window-level move/up still track it */
          }
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          pointerX.current = e.clientX - rect.left;

          const live = drag.current;
          if (!live || live.pointerId !== e.pointerId) return;
          const dx = e.clientX - live.lastX;
          if (Math.abs(dx) > 0) live.lastX = e.clientX;
          if (Math.abs(dx) >= DRAG_SLOP_PX) live.moved = true;
          // Turn the ring by the distance dragged, in the direction of the
          // drag: pulling left brings the next day toward the front, the same
          // way the arrow keys and a swipe on a photo roll read.
          phase.current = wrapPhase(phase.current + dx / DRAG_PX_PER_TURN);
          target.current = null;
        }}
        onPointerUp={() => {
          const live = drag.current;
          drag.current = null;
          if (!live) return;
          // A drag that moved is not a click: leave focus alone and settle on
          // whatever is now nearest the front.
          if (live.moved) {
            spinTo(frontIndex(phase.current, count));
            return;
          }
          // A tap. On a look it focuses that look; on the backdrop it lets go.
          if (live.downIndex != null && Number.isFinite(live.downIndex)) {
            spinTo(live.downIndex);
            setFocused(live.downIndex);
          } else {
            setFocused(null);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          pointerX.current = null;
        }}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
      >
        {days.map((day, i) => (
          <div
            key={day.day}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            style={{
              position: "absolute",
              left: `calc(50% - ${SLIDE_WIDTH / 2}px)`,
              top: `calc(50% - ${SLIDE_HEIGHT / 2}px)`,
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              willChange: "transform, opacity",
            }}
          >
            <button
              type="button"
              data-look-index={i}
              onClick={(e) => {
                /*
                 * Keyboard only. A mouse click is already handled on the ring
                 * from the pointerdown target, and `detail` distinguishes the
                 * two: it counts clicks for a real pointer and is 0 when the
                 * click came from Enter or Space.
                 */
                if (e.detail !== 0) return;
                spinTo(i);
                setFocused(i);
              }}
              aria-label={`Focus ${day.label}`}
              aria-current={i === front}
              aria-pressed={focused === i}
              className="flex h-full w-full flex-col items-center justify-end"
            >
              <LookSlide day={day} prefs={prefs} />
              <span
                ref={(el) => {
                  labelRefs.current[i] = el;
                }}
                className={`mt-1 whitespace-nowrap rounded-full px-3 py-1 text-[11px] ${
                  day.complete ? "text-ink-muted" : "bg-amber-50 text-amber-900"
                }`}
              >
                {day.label}
                {day.activity ? ` · ${day.activity}` : ""}
              </span>
            </button>
          </div>
        ))}
      </div>
    </motion.div>,
    document.body,
  );
}

/**
 * One day's look, fitted into a slide.
 *
 * The composition lives in a fixed 560x960 coordinate space because that's what
 * saved positions are expressed in. Rather than resize that space — which would
 * move everything the user has ever placed — the whole thing is rendered inside
 * a box scaled to fit, exactly as the outfit canvas does it.
 */
function LookSlide({ day, prefs }: { day: LookDay; prefs: LookLayoutPrefs }) {
  const placed = useMemo(
    () => composeLook(day.pieces.map((p) => ({ id: p.id, category: p.category })), prefs),
    [day.pieces, prefs],
  );

  // Fit the look's own extent, not the whole canvas: three pieces occupy about
  // a third of a 560x960 frame, and fitting the frame would render them as a
  // stamp in a lot of nothing.
  const bounds = useMemo(() => lookBounds(placed, PIECE_SIZE), [placed]);
  const pad = 24;
  const scale = Math.min(
    SLIDE_WIDTH / (bounds.width + pad * 2),
    (SLIDE_HEIGHT - 28) / (bounds.height + pad * 2),
  );

  const byId = new Map(day.pieces.map((p) => [p.id, p]));

  if (day.pieces.length === 0) {
    return (
      <span className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-ink-muted">
        Nothing to wear — pack a top, a bottom and shoes.
      </span>
    );
  }

  return (
    <span className="relative block h-full w-full overflow-hidden">
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: LOOK_FRAME_WIDTH,
          height: LOOK_FRAME_HEIGHT,
          // Centre the look's own bounding box in the slide, then fit it.
          transform: `translate(-50%, -50%) scale(${scale}) translate(${
            LOOK_FRAME_WIDTH / 2 - (bounds.x + bounds.width / 2)
          }px, ${LOOK_FRAME_HEIGHT / 2 - (bounds.y + bounds.height / 2)}px)`,
        }}
        className="block"
      >
        {placed.map((piece) => (
          <LookPieceImage
            key={piece.id}
            piece={piece}
            imagePath={byId.get(piece.id)?.imagePath}
            name={byId.get(piece.id)?.name ?? ""}
            tile={byId.get(piece.id)?.tile}
          />
        ))}
      </span>
    </span>
  );
}

/** One placed garment, background removed. */
function LookPieceImage({
  piece,
  imagePath,
  name,
  tile,
}: {
  piece: PlacedPiece;
  imagePath: string | undefined;
  name: string;
  tile?: ItemTileMeta;
}) {
  const cutout = useCutout(imagePath);
  if (!cutout) return null;


  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cutout}
      alt={name}
      draggable={false}
      style={{
        position: "absolute",
        left: piece.x,
        top: piece.y,
        width: PIECE_SIZE,
        height: PIECE_SIZE,
        zIndex: piece.z,
        // The look's own placement, then the item's saved framing, composed in
        // that order so a flip mirrors the garment rather than its position.
        transform: `translate(-50%, -50%) scale(${piece.scale})${itemTileTransformSuffix(tile)}`,
      }}
      className="pointer-events-none select-none object-contain"
    />
  );
}
