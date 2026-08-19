"use client";

/**
 * Drag-to-pack.
 *
 * Pointer events plus `setPointerCapture`, following the swipe deck in
 * `app/closet/sell/triage/sell-swiper.tsx` rather than the HTML5 drag-and-drop
 * API — that API can't be styled beyond a browser-drawn ghost, and it does
 * nothing at all on touch.
 *
 * Three pieces:
 *   • `PackingDragProvider` holds the in-flight drag and the registered zones.
 *   • `useDragHandle` turns a thumbnail into a grab handle.
 *   • `useDropZone` registers a bag (or the unpacked pool) as a target.
 *
 * The grab handle is the item's own picture, and only the picture. Making the
 * whole row draggable would mean `touch-action: none` across it, which kills
 * scrolling the bag column on a phone; grabbing the thing's image to move the
 * thing is also the more obvious affordance.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GearIcon } from "@/components/gear-icon";
import { thumbnailUrl } from "@/lib/image-paths";
import { springSnappy } from "@/lib/ui-motion";
import { passedThreshold, zoneAtPoint, type DropZone } from "@/lib/packing/drag";

/** What's being dragged, and what it costs the bag it lands in. */
export type DragPayload = {
  kind: "item" | "gear";
  id: string;
  name: string;
  /** Garments carry a photo; gear carries an icon name. */
  imagePath?: string;
  icon?: string;
  volumeLiters: number;
  weightGrams: number;
  /** Bag it came from, so a drop back onto the same bag is a no-op. */
  fromZoneId: string;
};

type DragState = {
  payload: DragPayload;
  x: number;
  y: number;
  /** Pointer offset within the handle, so the card doesn't jump on grab. */
  grabDx: number;
  grabDy: number;
  overZoneId: string | null;
};

type DragContextValue = {
  drag: DragState | null;
  /**
   * The payload hovering a given zone, or null. Null both when nothing is over
   * it and when what's over it came from it, so callers get one answer to
   * "would a drop here change anything?".
   */
  previewFor: (zoneId: string) => DragPayload | null;
  registerZone: (id: string, el: HTMLElement | null) => void;
  beginDrag: (event: React.PointerEvent, payload: DragPayload) => void;
};

const DragContext = createContext<DragContextValue | null>(null);

export function PackingDragProvider({
  onDrop,
  children,
}: {
  /** Called with the payload and the zone it landed on. Same-zone drops are filtered out. */
  onDrop: (payload: DragPayload, zoneId: string) => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const zones = useRef(new Map<string, HTMLElement>());
  /**
   * The live drag also lives in a ref. The pointer handlers are attached once
   * to `window` and would otherwise close over the state from the render that
   * attached them, seeing `null` forever.
   */
  const dragRef = useRef<DragState | null>(null);
  const pending = useRef<{ payload: DragPayload; startX: number; startY: number; grabDx: number; grabDy: number } | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const setDragBoth = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const registerZone = useCallback((id: string, el: HTMLElement | null) => {
    if (el) zones.current.set(id, el);
    else zones.current.delete(id);
  }, []);

  /** Rects are read per move rather than cached: the bag column scrolls. */
  const currentZones = useCallback((): DropZone[] => {
    const out: DropZone[] = [];
    for (const [id, el] of zones.current) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({ id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
    }
    return out;
  }, []);

  const beginDrag = useCallback(
    (event: React.PointerEvent, payload: DragPayload) => {
      /*
       * Let the row's own controls win — pressing Remove inside a draggable row
       * must remove, not drag. But the handle itself is sometimes a button (an
       * orbiting piece is one, so it can be clicked to open its adjust panel),
       * and bailing on that made those undraggable. Only *other* controls count.
       */
      const control = (event.target as HTMLElement).closest(
        "button, select, input, a, textarea",
      );
      if (control && control !== event.currentTarget) return;
      if (event.button !== 0 && event.pointerType === "mouse") return;

      const rect = event.currentTarget.getBoundingClientRect();
      pending.current = {
        payload,
        startX: event.clientX,
        startY: event.clientY,
        grabDx: event.clientX - rect.left,
        grabDy: event.clientY - rect.top,
      };
      // Capture so the drag survives the pointer leaving the handle. Guarded:
      // it throws NotFoundError for a pointer id the element never saw, and
      // the drag works off the window listeners regardless — losing capture
      // is a degraded drag, not a broken one.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* no capture available; window listeners still track the pointer */
      }
    },
    [],
  );

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const start = pending.current;
      if (start && !dragRef.current) {
        if (!passedThreshold({ x: start.startX, y: start.startY }, { x: event.clientX, y: event.clientY })) {
          return;
        }
        setDragBoth({
          payload: start.payload,
          x: event.clientX,
          y: event.clientY,
          grabDx: start.grabDx,
          grabDy: start.grabDy,
          overZoneId: null,
        });
      }
      const live = dragRef.current;
      if (!live) return;
      event.preventDefault();
      setDragBoth({
        ...live,
        x: event.clientX,
        y: event.clientY,
        overZoneId: zoneAtPoint(currentZones(), event.clientX, event.clientY),
      });
    }

    function onUp() {
      const live = dragRef.current;
      pending.current = null;
      if (!live) return;
      const { payload, overZoneId } = live;
      setDragBoth(null);
      // Dropping something back where it came from isn't a move.
      if (overZoneId && overZoneId !== payload.fromZoneId) onDropRef.current(payload, overZoneId);
    }

    function onCancel() {
      pending.current = null;
      setDragBoth(null);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [currentZones, setDragBoth]);

  const previewFor = useCallback(
    (zoneId: string) =>
      drag && drag.overZoneId === zoneId && drag.payload.fromZoneId !== zoneId ? drag.payload : null,
    [drag],
  );

  const value = useMemo<DragContextValue>(
    () => ({
      drag,
      previewFor,
      registerZone,
      beginDrag,
    }),
    [drag, previewFor, registerZone, beginDrag],
  );

  return (
    <DragContext.Provider value={value}>
      {children}
      <DragLayer drag={drag} />
    </DragContext.Provider>
  );
}

function usePackingDrag(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error("usePackingDrag must be used inside PackingDragProvider");
  return ctx;
}

/**
 * Props for the element that starts a drag — the item's thumbnail.
 *
 * `touch-action: none` is scoped to this element alone so the surrounding
 * column still scrolls normally under a finger.
 */
export function useDragHandle(payload: DragPayload) {
  const { beginDrag, drag } = usePackingDrag();
  const isDragging = drag?.payload.kind === payload.kind && drag?.payload.id === payload.id;
  return {
    onPointerDown: (event: React.PointerEvent) => beginDrag(event, payload),
    style: { touchAction: "none" as const, cursor: isDragging ? "grabbing" : "grab" },
    "data-dragging": isDragging ? "true" : undefined,
    isDragging,
  };
}

/** Register an element as a drop target and learn what's hovering it. */
export function useDropZone(zoneId: string) {
  const { registerZone, previewFor } = usePackingDrag();
  const ref = useCallback(
    (el: HTMLElement | null) => registerZone(zoneId, el),
    [registerZone, zoneId],
  );
  const incoming = previewFor(zoneId);
  return {
    ref,
    /**
     * Only true when a drop here would actually do something. Dragging an item
     * around inside the bag it already lives in lit that bag up and promised a
     * move that `onDrop` then correctly refused to make.
     */
    isOver: incoming != null,
    incoming,
  };
}

/** Is anything being dragged right now? Used to reveal the drop hints. */
export function useIsDragging(): boolean {
  return usePackingDrag().drag != null;
}

/**
 * The card under the cursor.
 *
 * Rendered in a portal on `document.body` so no ancestor's `overflow: hidden`
 * — and the bag column has one — can clip it mid-flight.
 */
function DragLayer({ drag }: { drag: DragState | null }) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {drag ? (
        <motion.div
          key="packing-drag"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{
            opacity: 1,
            // A touch of lift and tilt so the card reads as picked up rather
            // than merely moved. Skipped under reduced motion.
            scale: reduceMotion ? 1 : 1.04,
            rotate: reduceMotion ? 0 : -2.5,
          }}
          exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.14 } }}
          transition={reduceMotion ? { duration: 0 } : springSnappy}
          className="pointer-events-none fixed z-[100] flex items-center gap-2.5 rounded-xl border border-ink/20 bg-paper py-2 pl-2 pr-3 shadow-tile"
          style={{
            left: drag.x - drag.grabDx,
            top: drag.y - drag.grabDy,
          }}
        >
          <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-paper-warm">
            {drag.payload.kind === "item" && drag.payload.imagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl(drag.payload.imagePath)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink">
                <GearIcon name={drag.payload.icon ?? "pouch"} className="h-5 w-5" />
              </span>
            )}
          </span>
          <span className="max-w-[11rem] truncate text-xs">{drag.payload.name}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
