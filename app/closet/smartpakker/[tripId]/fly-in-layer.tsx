"use client";

/**
 * The piece you just dropped, flying from your pointer into the pack.
 *
 * A fixed-position overlay rather than part of the orbit system, for one reason:
 * it must start at the release point on the *next frame after pointerup*, before
 * the server has confirmed anything. Anything driven by React state after a
 * round trip cannot do that — the piece would disappear at the drop and reappear
 * later, which is what made the previous three attempts feel wrong no matter how
 * the curve was tuned.
 *
 * Consequences of that choice, all deliberate:
 *
 *  - Client coordinates throughout. No conversion into stage space, so no chance
 *    of the two being measured in different frames.
 *  - The target is re-measured every frame from the live element, so the reflow
 *    that happens when the rail loses a row simply moves the target mid-flight.
 *  - Styles are written straight to the node in rAF, like the orbit loop, so a
 *    two-second flight costs no re-renders.
 */

import { useEffect, useRef } from "react";
import { thumbnailUrl } from "@/lib/image-paths";
import { useCutout } from "@/lib/use-cutout";
import { FLY_IN_DURATION_MS, flyInFrame, flyInProgress } from "@/lib/packing/fly-in";

export type FlyIn = {
  /** Content key, so a second drop of the same piece replaces the first. */
  key: string;
  /** Client coordinates of the release. */
  release: { x: number; y: number };
  imagePath: string | null;
  /** Size to draw, matched to the orbiting pieces. */
  size: number;
};

export function FlyInLayer({
  flight,
  targetRef,
  onDone,
}: {
  flight: FlyIn | null;
  /** The pack element to fly into; measured live, every frame. */
  targetRef: React.MutableRefObject<HTMLDivElement | null>;
  onDone: (key: string) => void;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const cutout = useCutout(flight?.imagePath ?? null);

  useEffect(() => {
    if (!flight) return;
    const node = nodeRef.current;
    if (!node) return;

    let raf = 0;
    let start: number | null = null;
    const { key, release } = flight;

    const frame = (now: number) => {
      if (start == null) start = now;
      const elapsed = now - start;
      const p = flyInProgress(elapsed);

      // Live target: the pack moves when the rail above it reflows, and the
      // flight should follow it rather than land where it used to be.
      const rect = targetRef.current?.getBoundingClientRect();
      const target = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : release;

      const f = flyInFrame(release, target, p);
      node.style.transform = `translate3d(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${f.scale.toFixed(3)})`;
      node.style.opacity = f.opacity.toFixed(3);

      if (elapsed >= FLY_IN_DURATION_MS) {
        onDone(key);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    // Paint the first frame synchronously at the release point, so there is no
    // gap between letting go and the flight starting.
    const f0 = flyInFrame(release, release, 0);
    node.style.transform = `translate3d(${f0.x.toFixed(1)}px, ${f0.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(1)`;
    node.style.opacity = "1";

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [flight, targetRef, onDone]);

  if (!flight) return null;

  const src = cutout ?? (flight.imagePath ? thumbnailUrl(flight.imagePath) : null);

  return (
    <div
      ref={nodeRef}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[200]"
      style={{ width: flight.size, height: flight.size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-contain drop-shadow-lg" />
      ) : (
        <div className="h-full w-full rounded-full bg-ink/20" />
      )}
    </div>
  );
}
