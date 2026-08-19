"use client";

import type { CSSProperties } from "react";
import { planeFlightVars } from "@/lib/packing/planner-view";

/**
 * The plane that leaves the auto-pack button and flies to whatever sits at the
 * far end of its row — one second, once per press, then it and its trail fade.
 *
 * The wrapper is the flight track: a flex-1 item filling whatever space is left
 * in the row, so the route is the real distance between its neighbours at any
 * width and nothing has to be measured in JS. The plane and trail then animate
 * in percentages of it.
 *
 * Purely decorative — the button's own label already says "Packing…" — so it's
 * hidden from the accessibility tree. Motion lives in globals.css under
 * `.plane-route`, which puts it behind the app's prefers-reduced-motion rule
 * for free.
 */
export function PlaneRoute({ flying }: { flying: boolean }) {
  return (
    <span
      className="plane-route pointer-events-none relative hidden h-4 min-w-[2.5rem] flex-1 text-ink sm:block"
      data-state={flying ? "flying" : "idle"}
      style={planeFlightVars() as CSSProperties}
      aria-hidden="true"
    >
      {/* Dashed trail, growing behind the plane — its right edge tracks the
          plane because both run 0→100% of the same track. */}
      <span className="plane-trail absolute left-0 top-1/2 h-px -translate-y-1/2" />

      {/* Airliner from above, nose right. One closed silhouette: nose, swept
          wing, tailplane, tail cone, then the mirror of all four back up the
          other side. Centred on its own position so it meets the total nose-first. */}
      <span className="plane-craft absolute top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="17" height="13" viewBox="-8.5 -6.5 17 13" className="block">
          <path
            d="M 7.2 0
               C 7.2 -0.64 6 -1.1 4.25 -1.15
               L 1.36 -1.15 L -2.55 -5.45 L -3.75 -5.45 L -1.87 -1.28
               L -4.6 -1.28 L -6.1 -3.06 L -7 -3.06 L -6.3 -1.15
               L -7.2 -0.47 L -7.2 0.47
               L -6.3 1.15 L -7 3.06 L -6.1 3.06 L -4.6 1.28
               L -1.87 1.28 L -3.75 5.45 L -2.55 5.45 L 1.36 1.15
               L 4.25 1.15
               C 6 1.1 7.2 0.64 7.2 0 Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  );
}
