"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { imageUrl } from "@/lib/image-paths";
import { formatCents, suggestedAskingCents } from "@/lib/sale-listing";
import { fadeUp, scaleIn, springSnappy, springSoft } from "@/lib/ui-motion";
import { setSaleDecision, removeSaleListing } from "./actions";

export type SwipeItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  priceCents: number | null;
  currency: string;
  imagePath: string;
};

type Decision = "sell" | "keep";

/** px the top card must travel before release counts as a decision. */
const COMMIT_THRESHOLD = 110;
/** how many cards we render behind the top one (for the stacked look). */
const STACK_DEPTH = 3;

export function SellSwiper({ items, readyCount }: { items: SwipeItem[]; readyCount: number }) {
  const [cards, setCards] = useState<SwipeItem[]>(items);
  const [history, setHistory] = useState<{ item: SwipeItem; decision: Decision }[]>([]);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; decision: Decision } | null>(null);
  const [, startTransition] = useTransition();
  const reduce = useReducedMotion();

  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const decidedCount = history.length;
  const top = cards[0] ?? null;

  const commit = useCallback(
    (item: SwipeItem, decision: Decision) => {
      setLeaving({ id: item.id, decision });
      setDrag(null);
      setDragging(false);
      pointerStart.current = null;
      // Let the fly-off transition play, then drop the card from the stack.
      window.setTimeout(() => {
        setCards((prev) => prev.filter((c) => c.id !== item.id));
        setHistory((prev) => [...prev, { item, decision }]);
        setLeaving(null);
      }, reduce ? 0 : 280);
    },
    [startTransition, reduce],
  );

  // Keep server sync in commit without stale deps warning
  const commitWithServer = useCallback(
    (item: SwipeItem, decision: Decision) => {
      commit(item, decision);
      startTransition(async () => {
        await setSaleDecision({ itemId: item.id, decision });
      });
    },
    [commit, startTransition],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((prev) => prev.slice(0, -1));
    setCards((prev) => [last.item, ...prev]);
    startTransition(async () => {
      await removeSaleListing(last.item.id);
    });
  }, [history, startTransition]);

  function onPointerDown(e: React.PointerEvent) {
    if (!top || leaving) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointerStart.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointerStart.current) return;
    setDrag({
      dx: e.clientX - pointerStart.current.x,
      dy: e.clientY - pointerStart.current.y,
    });
  }

  function onPointerUp() {
    if (!top || !pointerStart.current) return;
    const dx = drag?.dx ?? 0;
    if (dx > COMMIT_THRESHOLD) {
      commitWithServer(top, "sell");
    } else if (dx < -COMMIT_THRESHOLD) {
      commitWithServer(top, "keep");
    } else {
      setDrag(null);
      setDragging(false);
      pointerStart.current = null;
    }
  }

  if (cards.length === 0) {
    return (
      <DoneState
        decidedCount={decidedCount}
        readyCount={readyCount}
        onUndo={history.length ? undo : undefined}
      />
    );
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const intent: Decision | null = dx > 40 ? "sell" : dx < -40 ? "keep" : null;

  return (
    <motion.div
      className="select-none"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative mx-auto h-[28rem] w-full max-w-sm">
        {cards.slice(0, STACK_DEPTH).map((item, i) => {
          const isTop = i === 0;
          const isLeaving = leaving?.id === item.id;
          const dir = leaving?.decision === "sell" ? 1 : -1;
          const scale = 1 - i * 0.04;
          const offset = i * 12;

          let animate: {
            x: number;
            y: number;
            rotate: number;
            scale: number;
            opacity: number;
          };
          if (isLeaving) {
            animate = {
              x: dir * (typeof window !== "undefined" ? window.innerWidth * 0.55 : 420),
              y: dy,
              rotate: dir * 18,
              scale: 1,
              opacity: 0,
            };
          } else if (isTop) {
            animate = {
              x: drag ? dx : 0,
              y: drag ? dy : 0,
              rotate: drag ? dx / 22 : 0,
              scale: 1,
              opacity: 1,
            };
          } else {
            animate = {
              x: 0,
              y: offset,
              rotate: 0,
              scale,
              opacity: 1,
            };
          }

          return (
            <motion.article
              key={item.id}
              className="absolute inset-0 rounded-3xl bg-white shadow-tile overflow-hidden border border-ink/10"
              style={{
                zIndex: STACK_DEPTH - i,
                cursor: isTop ? (dragging ? "grabbing" : "grab") : "default",
                touchAction: "none",
              }}
              animate={animate}
              transition={
                isLeaving
                  ? { duration: 0.28, ease: "easeOut" }
                  : isTop && dragging
                    ? { duration: 0 }
                    : springSoft
              }
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerUp : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(item.imagePath)}
                alt={item.name}
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover pointer-events-none"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-5 pt-12 text-white">
                <div className="text-lg font-medium leading-tight">{item.name}</div>
                <div className="text-sm text-white/80">{item.brand ?? "—"}</div>
                <div className="mt-1 text-xs text-white/70">
                  {item.priceCents
                    ? `Paid ${formatCents(item.priceCents, item.currency)} · resale ~${formatCents(
                        suggestedAskingCents(item.priceCents, "good"),
                        item.currency,
                      )}`
                    : item.category}
                </div>
              </div>

              <AnimatePresence>
                {isTop && intent && (
                  <motion.span
                    key={intent}
                    initial={reduce ? false : { opacity: 0, scale: 0.85 }}
                    animate={{
                      opacity: Math.min(1, Math.abs(dx) / COMMIT_THRESHOLD),
                      scale: 1,
                    }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`absolute top-5 rounded-xl border-2 px-3 py-1 text-sm font-bold uppercase tracking-widest ${
                      intent === "sell"
                        ? "right-5 rotate-12 border-emerald-400 text-emerald-300"
                        : "left-5 -rotate-12 border-rose-400 text-rose-300"
                    }`}
                  >
                    {intent === "sell" ? "Sell" : "Keep"}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.article>
          );
        })}
      </div>

      <motion.div
        className="mt-8 flex items-center justify-center gap-5"
        variants={fadeUp}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <motion.button
          type="button"
          onClick={() => top && commitWithServer(top, "keep")}
          aria-label="Keep"
          whileHover={reduce ? undefined : { scale: 1.08 }}
          whileTap={reduce ? undefined : { scale: 0.92 }}
          transition={springSnappy}
          className="grid h-16 w-16 place-items-center rounded-full border border-ink/15 bg-white text-2xl shadow-tile transition hover:bg-paper-warm"
        >
          ✕
        </motion.button>
        <motion.button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          aria-label="Undo last"
          whileHover={reduce || history.length === 0 ? undefined : { scale: 1.08 }}
          whileTap={reduce || history.length === 0 ? undefined : { scale: 0.92 }}
          transition={springSnappy}
          className="grid h-12 w-12 place-items-center rounded-full border border-ink/15 bg-white text-base shadow-tile transition hover:bg-paper-warm disabled:opacity-40"
        >
          ↶
        </motion.button>
        <motion.button
          type="button"
          onClick={() => top && commitWithServer(top, "sell")}
          aria-label="Sell"
          whileHover={reduce ? undefined : { scale: 1.08 }}
          whileTap={reduce ? undefined : { scale: 0.92 }}
          transition={springSnappy}
          className="grid h-16 w-16 place-items-center rounded-full bg-ink text-2xl text-paper shadow-tile transition hover:bg-ink-soft"
        >
          $
        </motion.button>
      </motion.div>

      <p className="mt-5 text-center text-xs text-ink-muted">
        {cards.length} {cards.length === 1 ? "piece" : "pieces"} left
        {readyCount > 0 || decidedCount > 0 ? (
          <>
            {" · "}
            <Link href="/closet/sell/listings" className="underline hover:text-ink">
              Review for-sale items
            </Link>
          </>
        ) : null}
      </p>
    </motion.div>
  );
}

function DoneState({
  decidedCount,
  readyCount,
  onUndo,
}: {
  decidedCount: number;
  readyCount: number;
  onUndo?: () => void;
}) {
  const total = readyCount;
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="rounded-3xl border border-ink/10 bg-paper-warm p-12 text-center"
      variants={scaleIn}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <p className="font-serif text-3xl">All caught up.</p>
      <p className="mt-2 text-ink-muted">
        {decidedCount > 0
          ? `You triaged ${decidedCount} ${decidedCount === 1 ? "piece" : "pieces"} this session.`
          : "Nothing left to swipe — every piece has been triaged."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/closet/sell/listings"
          className="rounded-full bg-ink px-6 py-2.5 text-sm tracking-wide text-paper transition hover:bg-ink-soft"
        >
          {total > 0 ? `Review ${total} for sale` : "View for-sale items"}
        </Link>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="rounded-full border border-ink/15 px-6 py-2.5 text-sm tracking-wide transition hover:bg-white"
          >
            Undo last
          </button>
        )}
        <Link
          href="/closet"
          className="rounded-full border border-ink/15 px-6 py-2.5 text-sm tracking-wide transition hover:bg-white"
        >
          Back to closet
        </Link>
      </div>
    </motion.div>
  );
}
