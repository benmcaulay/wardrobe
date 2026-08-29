"use client";

/**
 * "Train your stylist" (docs/OUTFIT_INTELLIGENCE.md §10).
 *
 * Choice data is what the preference model learns from, and the daily proposal
 * only yields one comparison a day because you only get dressed once. A round
 * here yields one every few seconds — it decouples how fast the model learns
 * from how often the user gets dressed, which was the binding constraint on the
 * whole personalization layer.
 *
 * Four shapes over the same fit:
 *
 *   pick   — N outfits, tap the best. `chosen ≻ every other outfit shown`, the
 *            richest input Bradley-Terry takes: one tap, N−1 comparisons.
 *   rate   — N outfits, like or dislike each independently. Less information per
 *            outfit than a pick, but nobody is forced to crown a winner among
 *            things they all dislike — which is where pick quietly lies.
 *   swipe  — one at a time, swipe or tap. Least information per answer and by far
 *            the fastest; some people will do fifty of these and none of the
 *            others.
 *   pieces — one *garment* at a time. The others all ask about outfits, so item
 *            taste has to be inferred from set-level choices where a three-piece
 *            pick spreads its weight across three garments. This asks the affinity
 *            question directly, which is the one thing §1 wants and nothing was
 *            collecting.
 *
 * Focus (pin pieces, restrict categories or colours) narrows what the round is
 * about. See lib/outfit/training-focus.ts for why those are hard exclusions.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { imageUrl } from "@/lib/image-paths";
import { normalizeCategoryName, isNoneCategoryStored } from "@/lib/categories";
import {
  DEFAULT_SAMPLE_SIZE,
  MAX_SAMPLE_SIZE,
  MIN_SAMPLE_SIZE,
  TRAINING_MODES,
  TRAINING_MODE_HINTS,
  TRAINING_MODE_LABELS,
  focusIsEmpty,
  isPieceMode,
  type TrainingFocus,
  type TrainingMode,
} from "@/lib/outfit/training-focus";
import {
  getPieceRound,
  getTrainingRound,
  recordPieceRating,
  recordTrainingPick,
  recordTrainingRate,
  type TrainingOutfit,
  type TrainingPiece,
} from "@/lib/actions/training";
import type { RandomOutfitItem } from "./random-outfit-builder";

export function StylistTrainer({
  items,
  colorOptions,
  onLearned,
  rulesPanel,
}: {
  items: RandomOutfitItem[];
  colorOptions: { name: string; hex: string }[];
  onLearned: () => void;
  /** Standing rules + the note history. Teaching by instruction, next to
   *  teaching by example — see style-rules-panel.tsx. */
  rulesPanel?: ReactNode;
}) {
  const [mode, setMode] = useState<TrainingMode>("pick");
  const [sampleSize, setSampleSize] = useState(DEFAULT_SAMPLE_SIZE);
  const [pinnedItemIds, setPinnedItemIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [colorNames, setColorNames] = useState<string[]>([]);

  const [outfits, setOutfits] = useState<TrainingOutfit[]>([]);
  const [answered, setAnswered] = useState(0);
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const [exhausted, setExhausted] = useState(false);
  const [busy, startTransition] = useTransition();

  // Piece rounds keep their own state: they ask about garments, not outfits, so
  // nothing about a round of three outfits carries over.
  const [pieces, setPieces] = useState<TrainingPiece[]>([]);
  const [pieceVerdicts, setPieceVerdicts] = useState<Record<string, boolean>>({});
  const [pieceProgress, setPieceProgress] = useState({ rated: 0, total: 0 });

  const focus: TrainingFocus = useMemo(
    () => ({ pinnedItemIds, categories, colorNames }),
    [pinnedItemIds, categories, colorNames],
  );

  const load = useCallback(
    (nextMode: TrainingMode, nextSize: number, nextFocus: TrainingFocus) => {
      startTransition(async () => {
        // A piece round needs no outfit built, so the focus filters — which exist
        // to shape an outfit — don't apply to it.
        if (isPieceMode(nextMode)) {
          const round = await getPieceRound(nextSize);
          setPieces(round.pieces);
          setPieceProgress({ rated: round.rated, total: round.total });
          setPieceVerdicts({});
          setExhausted(round.pieces.length === 0);
          return;
        }
        const round = await getTrainingRound({
          mode: nextMode,
          sampleSize: nextSize,
          focus: nextFocus,
        });
        setOutfits(round.outfits);
        setAnswered(round.answered);
        setRated({});
        // A round that can't produce the comparison its mode needs can't be
        // trained on — usually because the focus is too tight to fill a frame.
        setExhausted(round.outfits.length < (nextMode === "swipe" ? 1 : 2));
      });
    },
    [],
  );

  useEffect(() => {
    load(mode, sampleSize, focus);
  }, [load, mode, sampleSize, focus]);

  /**
   * Refresh the rest of the page every few answers rather than after each one.
   * Re-ranking under someone mid-tap is disorienting, and one comparison moves
   * the model very little anyway — λ ramps slowly by design.
   */
  function maybeRefresh(count: number) {
    if (count % 5 === 0) onLearned();
  }

  function onPick(chosen: TrainingOutfit) {
    // Send the whole round, in display order, plus which one was tapped. One tap
    // on n outfits is n−1 preferences; sending only the winner and a flattened
    // remainder threw all but one of them away before it reached the database.
    const arms = outfits.map((o) => o.items.map((i) => i.id));
    const chosenArm = outfits.findIndex((o) => o.key === chosen.key);
    if (arms.length < 2 || chosenArm < 0) return;
    startTransition(async () => {
      // The chosen arm's propensity goes back with the answer: it exists only
      // while the round is being built, and off-policy evaluation of any future
      // ranker depends on having it (docs/OUTFIT_INTELLIGENCE.md §8).
      const result = await recordTrainingPick(arms, chosenArm, chosen.propensity);
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
      }
      load(mode, sampleSize, focus);
    });
  }

  /** Rate one outfit of a set without ending the round. */
  function onRateOne(outfit: TrainingOutfit, liked: boolean) {
    startTransition(async () => {
      const result = await recordTrainingRate(
        outfit.items.map((i) => i.id),
        liked,
        outfit.propensity,
      );
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
      }
      setRated((prev) => ({ ...prev, [outfit.key]: liked }));
    });
  }

  /** Swipe mode: one answer, then straight to the next outfit. */
  function onSwipe(liked: boolean) {
    const outfit = outfits[0];
    if (!outfit) return;
    startTransition(async () => {
      const result = await recordTrainingRate(
        outfit.items.map((i) => i.id),
        liked,
        outfit.propensity,
      );
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
      }
      load(mode, sampleSize, focus);
    });
  }

  /** One garment, liked or passed. */
  function onRatePiece(piece: TrainingPiece, liked: boolean) {
    startTransition(async () => {
      const result = await recordPieceRating(piece.id, liked);
      if (result.ok) {
        setAnswered(result.answered);
        maybeRefresh(result.answered);
        setPieceProgress((prev) => ({ ...prev, rated: prev.rated + 1 }));
      }
      setPieceVerdicts((prev) => ({ ...prev, [piece.id]: liked }));
    });
  }

  const allRated = outfits.length > 0 && outfits.every((o) => o.key in rated);
  const allPiecesRated = pieces.length > 0 && pieces.every((p) => p.id in pieceVerdicts);

  const categoryOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of items) {
      if (isNoneCategoryStored(item.category)) continue;
      const key = normalizeCategoryName(item.category);
      if (!key || labels.has(key)) continue;
      labels.set(key, item.category.trim());
    }
    return [...labels.values()].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const colorNameOptions = useMemo(() => {
    const merged = colorOptions.map((c) => c.name);
    for (const name of new Set(items.flatMap((i) => i.colors.map((c) => c.name)).filter(Boolean))) {
      if (!merged.some((m) => m.toLowerCase() === name.toLowerCase())) merged.push(name);
    }
    return merged.sort((a, b) => a.localeCompare(b));
  }, [items, colorOptions]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <section className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-tile">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl">Train your stylist</h2>
          <span className="text-xs text-ink-muted">
            {answered > 0
              ? `${answered} answered`
              : "A few taps here teach me more than a week of getting dressed"}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TRAINING_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                mode === option
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
              }`}
            >
              {TRAINING_MODE_LABELS[option]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{TRAINING_MODE_HINTS[mode]}</p>

        {mode !== "swipe" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor="sample-size" className="text-[11px] uppercase tracking-wide text-ink-muted">
              {isPieceMode(mode) ? "Pieces per round" : "Outfits per round"}
            </label>
            <input
              id="sample-size"
              type="range"
              min={isPieceMode(mode) ? 1 : MIN_SAMPLE_SIZE}
              max={MAX_SAMPLE_SIZE}
              value={sampleSize}
              onChange={(e) => setSampleSize(Number(e.target.value))}
              className="h-1.5 w-40 accent-ink"
            />
            <span className="text-sm tabular-nums">{sampleSize}</span>
            {isPieceMode(mode) && pieceProgress.total > 0 ? (
              <span className="text-xs text-ink-muted">
                {pieceProgress.rated} of {pieceProgress.total} pieces rated
              </span>
            ) : null}
          </div>
        ) : null}

        {exhausted && isPieceMode(mode) ? (
          <p className="mt-6 rounded-xl bg-paper-warm px-3 py-2 text-xs text-ink-muted">
            Nothing to rate — the closet is empty, or everything in it is listed for sale.
          </p>
        ) : isPieceMode(mode) ? (
          <PieceRound
            pieces={pieces}
            verdicts={pieceVerdicts}
            busy={busy}
            allRated={allPiecesRated}
            onRate={onRatePiece}
            onNext={() => load(mode, sampleSize, focus)}
          />
        ) : exhausted ? (
          <p className="mt-6 rounded-xl bg-paper-warm px-3 py-2 text-xs text-ink-muted">
            {focusIsEmpty(focus)
              ? "Not enough pieces to build a comparison yet — add a top, a bottom and some shoes."
              : "Nothing left that fits this focus. Loosen a filter or unpin a piece."}
          </p>
        ) : mode === "pick" ? (
          <PickRound outfits={outfits} busy={busy} onPick={onPick} />
        ) : mode === "rate" ? (
          <RateRound
            outfits={outfits}
            rated={rated}
            busy={busy}
            allRated={allRated}
            onRate={onRateOne}
            onNext={() => load(mode, sampleSize, focus)}
          />
        ) : (
          <SwipeRound outfit={outfits[0]} busy={busy} onSwipe={onSwipe} />
        )}
      </section>

      <div className="space-y-6">
      <FocusPanel
        items={items}
        pinnedItemIds={pinnedItemIds}
        categories={categories}
        colorNames={colorNames}
        categoryOptions={categoryOptions}
        colorNameOptions={colorNameOptions}
        onTogglePinned={(id) =>
          setPinnedItemIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onToggleCategory={(name) =>
          setCategories((prev) =>
            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
          )
        }
        onToggleColor={(name) =>
          setColorNames((prev) =>
            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
          )
        }
        onClear={() => {
          setPinnedItemIds([]);
          setCategories([]);
          setColorNames([]);
        }}
      />
      {rulesPanel}
      </div>
    </div>
  );
}

/** N outfits, one winner. */
function PickRound({
  outfits,
  busy,
  onPick,
}: {
  outfits: TrainingOutfit[];
  busy: boolean;
  onPick: (outfit: TrainingOutfit) => void;
}) {
  if (outfits.length === 0) return <Loading />;
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {outfits.map((outfit) => (
        <li key={outfit.key}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(outfit)}
            className="w-full rounded-xl border border-ink/10 p-2 text-left transition hover:border-ink/40 disabled:opacity-50"
          >
            <OutfitStrip outfit={outfit} />
            <span className="mt-2 block text-center text-[11px] text-ink-muted">This one</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** N outfits, each judged on its own. */
function RateRound({
  outfits,
  rated,
  busy,
  allRated,
  onRate,
  onNext,
}: {
  outfits: TrainingOutfit[];
  rated: Record<string, boolean>;
  busy: boolean;
  allRated: boolean;
  onRate: (outfit: TrainingOutfit, liked: boolean) => void;
  onNext: () => void;
}) {
  if (outfits.length === 0) return <Loading />;
  return (
    <>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {outfits.map((outfit) => {
          const verdict = rated[outfit.key];
          const done = outfit.key in rated;
          return (
            <li
              key={outfit.key}
              className={`rounded-xl border p-2 transition ${
                done ? "border-ink/10 opacity-60" : "border-ink/10"
              }`}
            >
              <OutfitStrip outfit={outfit} />
              {done ? (
                <p className="mt-2 text-center text-[11px] text-ink-muted">
                  {verdict ? "Liked" : "Disliked"}
                </p>
              ) : (
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRate(outfit, false)}
                    className="flex-1 rounded-full border border-ink/15 bg-surface px-2 py-1 text-[11px] text-ink-muted transition hover:bg-paper-warm disabled:opacity-50"
                  >
                    Dislike
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRate(outfit, true)}
                    className="flex-1 rounded-full border border-ink bg-ink px-2 py-1 text-[11px] text-paper transition hover:opacity-90 disabled:opacity-50"
                  >
                    Like
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={onNext}
        className="mt-4 rounded-full border border-ink/15 bg-surface px-4 py-1.5 text-xs text-ink transition hover:bg-paper-warm disabled:opacity-50"
      >
        {allRated ? "Next round →" : "Skip the rest →"}
      </button>
    </>
  );
}

/**
 * One outfit at a time, dating-app style.
 *
 * Real dragging rather than just two buttons: the gesture is the point of this
 * mode. Pointer events so it works with a mouse, a trackpad and a finger from
 * one code path — and the buttons stay, because a keyboard has no swipe.
 */
function SwipeRound({
  outfit,
  busy,
  onSwipe,
}: {
  outfit: TrainingOutfit | undefined;
  busy: boolean;
  onSwipe: (liked: boolean) => void;
}) {
  /**
   * The grab point lives in a ref, not state.
   *
   * A pointermove that arrives in the same frame as its pointerdown would read a
   * stale `null` out of state — React hasn't re-rendered yet — and the drag
   * would silently do nothing. A ref is current the moment it's set.
   */
  const originRef = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flungTo, setFlungTo] = useState<"like" | "pass" | null>(null);

  /** Past this much horizontal travel, releasing counts as an answer. */
  const COMMIT_PX = 90;

  const commit = useCallback(
    (liked: boolean) => {
      originRef.current = null;
      setDragging(false);
      setFlungTo(liked ? "like" : "pass");
      // Let the card leave before the next one lands, so the answer reads as
      // having gone somewhere rather than the image just swapping.
      window.setTimeout(() => {
        setFlungTo(null);
        setDx(0);
        onSwipe(liked);
      }, 180);
    },
    [onSwipe],
  );

  const release = useCallback(
    (clientX: number | null) => {
      const origin = originRef.current;
      if (origin === null) return;
      originRef.current = null;
      setDragging(false);
      const travelled = clientX === null ? 0 : clientX - origin;
      if (Math.abs(travelled) >= COMMIT_PX) commit(travelled > 0);
      else setDx(0);
    },
    [commit],
  );

  useEffect(() => {
    originRef.current = null;
    setDragging(false);
    setDx(0);
    setFlungTo(null);
  }, [outfit?.key]);

  if (!outfit) return <Loading />;

  const intent = Math.abs(dx) < COMMIT_PX / 2 ? null : dx > 0 ? "like" : "pass";
  const offset = flungTo ? (flungTo === "like" ? 420 : -420) : dx;

  return (
    <div className="mt-5">
      <div className="relative mx-auto max-w-sm select-none">
        <div
          onPointerDown={(e) => {
            if (busy || flungTo) return;
            // Capture on the card, not the event target: the target is usually
            // one of the images, and the drag has to keep tracking once the
            // pointer leaves it. Guarded because capture throws on a pointer id
            // the element never saw, and a failed capture is no reason to
            // refuse the drag — it just means moves stop if you leave the card.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* fall through to plain pointermove tracking */
            }
            originRef.current = e.clientX;
            setDragging(true);
            setDx(0);
          }}
          onPointerMove={(e) => {
            if (originRef.current === null) return;
            setDx(e.clientX - originRef.current);
          }}
          onPointerUp={(e) => release(e.clientX)}
          onPointerCancel={() => release(null)}
          style={{
            transform: `translateX(${offset}px) rotate(${offset * 0.04}deg)`,
            transition: dragging ? "none" : "transform 180ms ease-out, opacity 180ms ease-out",
            opacity: flungTo ? 0 : 1,
            touchAction: "pan-y",
          }}
          className="cursor-grab rounded-2xl border border-ink/10 bg-surface p-3 shadow-tile active:cursor-grabbing"
        >
          <div className="flex gap-2">
            {outfit.items.map((item) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={item.id}
                src={imageUrl(item.imagePath)}
                alt={item.name}
                draggable={false}
                className="h-40 w-1/3 rounded-xl border border-ink/10 bg-paper object-cover"
              />
            ))}
          </div>

          {/* Verdict stamp — appears once the drag is far enough to count. */}
          {intent ? (
            <span
              className={`pointer-events-none absolute top-6 rounded-lg border-2 px-3 py-1 text-sm font-medium uppercase tracking-wide ${
                intent === "like"
                  ? "left-6 -rotate-12 border-emerald-600 text-emerald-700"
                  : "right-6 rotate-12 border-rose-600 text-rose-700"
              }`}
            >
              {intent === "like" ? "Would wear" : "Nope"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mx-auto mt-4 flex max-w-sm gap-2">
        <button
          type="button"
          disabled={busy || !!flungTo}
          onClick={() => commit(false)}
          className="flex-1 rounded-full border border-ink/15 bg-surface px-4 py-2 text-sm text-ink-muted transition hover:bg-paper-warm disabled:opacity-50"
        >
          Nope
        </button>
        <button
          type="button"
          disabled={busy || !!flungTo}
          onClick={() => commit(true)}
          className="flex-1 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          Would wear
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-ink-muted">
        Drag the card, or use the buttons.
      </p>
    </div>
  );
}

function OutfitStrip({ outfit }: { outfit: TrainingOutfit }) {
  return (
    <div className="flex gap-1">
      {outfit.items.map((item) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={item.id}
          src={imageUrl(item.imagePath)}
          alt={item.name}
          title={item.name}
          className="h-20 w-1/3 rounded-lg border border-ink/10 bg-paper object-cover"
        />
      ))}
    </div>
  );
}

function Loading() {
  return <p className="mt-5 text-xs text-ink-muted">Building a round…</p>;
}

/**
 * What this round is about.
 *
 * Without focus a round samples the whole closet, which is the right default but
 * teaches nothing in particular. Pinning a piece asks "what goes with this?";
 * the category and colour filters ask "how do I feel about these?".
 */
function FocusPanel({
  items,
  pinnedItemIds,
  categories,
  colorNames,
  categoryOptions,
  colorNameOptions,
  onTogglePinned,
  onToggleCategory,
  onToggleColor,
  onClear,
}: {
  items: RandomOutfitItem[];
  pinnedItemIds: string[];
  categories: string[];
  colorNames: string[];
  categoryOptions: string[];
  colorNameOptions: string[];
  onTogglePinned: (id: string) => void;
  onToggleCategory: (name: string) => void;
  onToggleColor: (name: string) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const active = pinnedItemIds.length + categories.length + colorNames.length;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((item) =>
        [item.name, item.brand ?? "", item.category, ...item.colors.map((c) => c.name)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [items, search]);

  const pinned = items.filter((item) => pinnedItemIds.includes(item.id));

  return (
    <aside className="rounded-2xl border border-ink/10 bg-surface p-4 shadow-tile">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-lg">Focus</h3>
        {active > 0 ? (
          <button type="button" onClick={onClear} className="text-[11px] text-ink-muted underline">
            Clear all
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Optional. Narrow what you&rsquo;re training and the comparisons come back about that
        instead of the whole closet.
      </p>

      <div className="mt-4">
        <h4 className="text-[11px] uppercase tracking-wide text-ink-muted">Keep these pieces in</h4>
        {pinned.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pinned.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onTogglePinned(item.id)}
                  title={`Unpin ${item.name}`}
                  className="flex items-center gap-1.5 rounded-full border border-ink bg-ink py-0.5 pl-0.5 pr-2.5 text-[11px] text-paper"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item.imagePath)}
                    alt=""
                    className="h-5 w-5 rounded-full bg-paper object-cover"
                  />
                  <span className="max-w-[8rem] truncate">{item.name}</span>
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a piece to pin…"
          aria-label="Search a piece to pin"
          className="mt-2 w-full rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-xs focus:border-ink/40 focus:outline-none"
        />
        {matches.length > 0 ? (
          <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto pr-1">
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onTogglePinned(item.id);
                    setSearch("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition hover:bg-paper-warm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item.imagePath)}
                    alt=""
                    className="h-7 w-7 rounded-md border border-ink/10 bg-paper object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-ink-muted">
                    {pinnedItemIds.includes(item.id) ? "Pinned" : "+"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <FilterChips
        title="Only these categories"
        options={categoryOptions}
        selected={categories}
        onToggle={onToggleCategory}
      />
      <FilterChips
        title="Only these colours"
        options={colorNameOptions}
        selected={colorNames}
        onToggle={onToggleColor}
      />
    </aside>
  );
}

function FilterChips({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Long lists are collapsed: a wardrobe with forty categories would otherwise
  // bury the modes above under a wall of chips.
  const shown = expanded ? options : options.slice(0, 10);

  if (options.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-[11px] uppercase tracking-wide text-ink-muted">{title}</h4>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {shown.map((name) => {
          const on = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-pressed={on}
              className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
              }`}
            >
              {name}
            </button>
          );
        })}
        {options.length > shown.length || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((o) => !o)}
            className="rounded-full px-2 py-0.5 text-[11px] text-ink-muted underline"
          >
            {expanded ? "Fewer" : `+${options.length - shown.length} more`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One garment at a time, liked or passed.
 *
 * Deliberately not the outfit strip: there is no outfit here, and showing a lone
 * garment inside an outfit frame would imply the judgement was about a look. The
 * name is shown because a ghost render of a black tee is hard to tell from
 * another black tee, and the answer should be about the piece the user thinks
 * they are rating.
 */
function PieceRound({
  pieces,
  verdicts,
  busy,
  allRated,
  onRate,
  onNext,
}: {
  pieces: TrainingPiece[];
  verdicts: Record<string, boolean>;
  busy: boolean;
  allRated: boolean;
  onRate: (piece: TrainingPiece, liked: boolean) => void;
  onNext: () => void;
}) {
  if (pieces.length === 0) return <Loading />;
  return (
    <>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pieces.map((piece) => {
          const done = piece.id in verdicts;
          return (
            <li
              key={piece.id}
              className={`rounded-xl border border-ink/10 p-2 transition ${done ? "opacity-60" : ""}`}
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-paper-warm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(piece.imagePath)}
                  alt={piece.name}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              </div>
              <p className="mt-1.5 truncate text-[11px] text-ink" title={piece.name}>
                {piece.name}
              </p>
              {done ? (
                <p className="mt-1 text-center text-[11px] text-ink-muted">
                  {verdicts[piece.id] ? "Liked" : "Not for me"}
                </p>
              ) : (
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRate(piece, false)}
                    className="flex-1 rounded-full border border-ink/15 bg-surface px-2 py-1 text-[11px] text-ink-muted transition hover:bg-paper-warm disabled:opacity-50"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRate(piece, true)}
                    className="flex-1 rounded-full border border-ink bg-ink px-2 py-1 text-[11px] text-paper transition hover:opacity-90 disabled:opacity-50"
                  >
                    Like
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={onNext}
        className="mt-4 rounded-full border border-ink/15 bg-surface px-4 py-1.5 text-xs text-ink transition hover:bg-paper-warm disabled:opacity-50"
      >
        {allRated ? "Next pieces →" : "Skip the rest →"}
      </button>
    </>
  );
}
