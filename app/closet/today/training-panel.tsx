"use client";

/**
 * "Help me get better" — training rounds (docs/OUTFIT_INTELLIGENCE.md §10).
 *
 * Two modes over the same data:
 *
 *   Pick   — three outfits, tap a favourite. One tap yields `chosen ≻ the other
 *            two`, the cleanest input Bradley-Terry takes.
 *   Swipe  — one outfit at a time, like or pass. Lower information per tap, but
 *            far faster, and some people will do fifty of these and none of the
 *            other. Both feed the same fit.
 *
 * Sits below the daily proposal rather than on its own page: the value is in
 * doing a handful while you're already here, and a surface you have to navigate
 * to is a surface nobody trains.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { imageUrl } from "@/lib/image-paths";
import {
  getTrainingRound,
  recordTrainingPick,
  recordTrainingRate,
  type TrainingOutfit,
} from "@/lib/actions/training";

type Mode = "pick" | "swipe";

export function TrainingPanel({ onLearned }: { onLearned: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("pick");
  const [outfits, setOutfits] = useState<TrainingOutfit[]>([]);
  const [answered, setAnswered] = useState(0);
  const [busy, startTransition] = useTransition();
  const [exhausted, setExhausted] = useState(false);

  const load = useCallback(
    (nextMode: Mode) => {
      startTransition(async () => {
        const round = await getTrainingRound(nextMode === "pick" ? 3 : 1);
        setOutfits(round.outfits);
        setAnswered(round.answered);
        // A closet that can't produce a comparison can't be trained on.
        setExhausted(round.outfits.length < (nextMode === "pick" ? 2 : 1));
      });
    },
    [],
  );

  useEffect(() => {
    if (open) load(mode);
  }, [open, mode, load]);

  /**
   * Refresh the daily slate every so often rather than after every answer.
   * Re-ranking under someone mid-tap is disorienting, and a single comparison
   * moves the model very little anyway (λ ramps slowly by design).
   */
  function maybeRefresh(count: number) {
    if (count % 5 === 0) onLearned();
  }

  function onPick(chosen: TrainingOutfit) {
    const rejected = outfits.filter((o) => o.key !== chosen.key).flatMap((o) => o.items.map((i) => i.id));
    startTransition(async () => {
      const result = await recordTrainingPick(chosen.items.map((i) => i.id), rejected);
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
      }
      load(mode);
    });
  }

  function onRate(liked: boolean) {
    const outfit = outfits[0];
    if (!outfit) return;
    startTransition(async () => {
      const result = await recordTrainingRate(outfit.items.map((i) => i.id), liked);
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
      }
      load(mode);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-ink/20 px-4 py-3 text-sm text-ink transition hover:bg-paper-warm"
      >
        Help me get better →
      </button>
    );
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">Help me get better</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-muted underline"
        >
          Done
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {answered > 0
          ? `${answered} answered — every one sharpens the suggestions above.`
          : "A few taps here teach me more than a week of getting dressed."}
      </p>

      <div className="mt-3 flex gap-2">
        {(["pick", "swipe"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              mode === option
                ? "border-ink bg-ink text-paper"
                : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
            }`}
          >
            {option === "pick" ? "Pick a favourite" : "One at a time"}
          </button>
        ))}
      </div>

      {exhausted ? (
        <p className="mt-4 text-xs text-ink-muted">
          Not enough pieces to build a comparison right now.
        </p>
      ) : mode === "pick" ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {outfits.map((outfit) => (
            <li key={outfit.key}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(outfit)}
                className="w-full rounded-xl border border-ink/10 p-2 text-left transition hover:border-ink/40 disabled:opacity-50"
              >
                <div className="flex gap-1">
                  {outfit.items.map((item) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={item.id}
                      src={imageUrl(item.imagePath)}
                      alt={item.name}
                      className="h-16 w-1/3 rounded-lg border border-ink/10 bg-paper object-cover"
                    />
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          {outfits[0] ? (
            <>
              <div className="flex gap-2">
                {outfits[0].items.map((item) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={item.id}
                    src={imageUrl(item.imagePath)}
                    alt={item.name}
                    className="h-28 w-1/3 rounded-xl border border-ink/10 bg-paper object-cover"
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRate(false)}
                  className="flex-1 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm text-ink-muted transition hover:bg-paper-warm disabled:opacity-50"
                >
                  Pass
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRate(true)}
                  className="flex-1 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition hover:opacity-90 disabled:opacity-50"
                >
                  Love it
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Loading…</p>
          )}
        </div>
      )}
    </section>
  );
}
