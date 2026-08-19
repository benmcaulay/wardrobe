"use client";

/**
 * A bag's volume or weight bar.
 *
 * Was a static div whose width tracked the current fill. It now also draws
 * what a hovering item *would* add, as a translucent segment beyond the solid
 * one, before you let go. That preview is the reason drag-to-pack is worth
 * building at all: "does this still fit" gets answered by looking at the bar
 * rather than by dropping the thing and re-reading a number.
 *
 * When the preview would exceed the bag, the whole meter turns rose and the
 * readout says by how much — a refusal is more useful than a bar that silently
 * stops at 100%.
 */

import { motion, useReducedMotion } from "motion/react";
import { fitPreview } from "@/lib/packing/drag";
import { springSoft } from "@/lib/ui-motion";

export function CapacityMeter({
  label,
  used,
  capacity,
  incoming,
  format,
  over,
}: {
  label: string;
  used: number;
  capacity: number;
  /** Size of the thing currently hovering this bag, in the same unit. */
  incoming: number | null;
  format: (value: number) => string;
  /** Already over capacity, before any drag. */
  over: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const preview = fitPreview({ used, capacity, incoming: incoming ?? 0 });
  const hovering = incoming != null && incoming > 0;
  const wouldOverflow = hovering && preview.overflows;
  const bad = over || wouldOverflow;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <span>{label}</span>
        <span className={bad ? "text-rose-700" : ""}>
          {hovering ? (
            <>
              {format(used + incoming)} / {format(capacity)}
              {wouldOverflow ? (
                <span className="ml-1">· {format(preview.overBy)} over</span>
              ) : null}
            </>
          ) : (
            <>
              {format(used)} / {format(capacity)}
            </>
          )}
        </span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-paper-warm">
        {/* The ghost segment sits underneath and runs to the previewed total,
            so the solid bar drawn over it reads as the part already packed. */}
        {hovering ? (
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${
              wouldOverflow ? "bg-rose-500/40" : "bg-ink/30"
            }`}
            initial={{ width: `${preview.usedFraction * 100}%` }}
            animate={{ width: `${preview.previewFraction * 100}%` }}
            transition={reduceMotion ? { duration: 0 } : springSoft}
          />
        ) : null}
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${bad ? "bg-rose-500" : "bg-ink"}`}
          animate={{ width: `${preview.usedFraction * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : springSoft}
        />
      </div>
    </div>
  );
}
