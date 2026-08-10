"use client";

/**
 * Today's weather and today's three looks (docs/OUTFIT_INTELLIGENCE.md §5B).
 * This was the "Today" tab; it now sits under the spin dial in the generator's
 * sidebar.
 *
 * It earns that space by being the thing that manufactures training data, not
 * by being another view of the closet. Every button writes a comparison under
 * known context — "Wearing this" is a confidence-1 wear *plus* a comparison,
 * "Something else" is the comparison alone — and that log is what the smart spin
 * and the stylist trainer both read from.
 *
 * Narrow by design: it lives in a 300px column, so proposals are compact rows
 * rather than the full-width cards they were on their own page. Standing rules
 * and the note history moved to the trainer — see style-rules-panel.tsx.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { imageUrl } from "@/lib/image-paths";
import { OCCASIONS, OCCASION_LABELS, type Occasion } from "@/lib/wear/occasions";
import { wornOnFromLocalDate, wornOnToISODate } from "@/lib/wear/rollup";
import { formatTemperature, type TemperatureUnit } from "@/lib/temperature";
import {
  acceptProposal,
  dismissSlate,
  getDailySlate,
  rerollProposal,
  setHomeLocation,
  type DailySlateResponse,
} from "@/lib/actions/daily-outfit";
import {
  confirmPendingWear,
  rejectPendingWear,
  type PendingWear,
} from "@/lib/actions/wear-confirm";
import { addStyleNote, type SavedNote } from "@/lib/actions/style-notes";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";

/**
 * Named by intent, not position. "Something different" sets the expectation
 * that the third one is a stretch, so a miss there reads as the feature working
 * rather than as a bad recommendation.
 */
const STRATEGY_LABEL: Record<string, string> = {
  safe: "First pick",
  alternative: "Another option",
  explore: "Something different",
};

const BAND_COPY: Record<string, string> = {
  hot: "Hot",
  warm: "Warm",
  mild: "Mild",
  cool: "Cool",
  cold: "Cold",
};

/**
 * One slate, two places on the page.
 *
 * The weather card sits in the generator's sidebar and the picks span the full
 * width beneath it, but they are the same fetch and the same busy flag — so the
 * state lives in a hook the page owns rather than inside either view. Two copies
 * would mean two forecasts, and a "Refresh" in one that the other ignored.
 */
export function useDailySlate({
  initialSlate,
  initialPending,
  onModelChanged,
  onNoteAdded,
}: {
  initialSlate: DailySlateResponse;
  initialPending: PendingWear[];
  /** Learned something — the generator's smart spin should re-pull its signals. */
  onModelChanged: () => void;
  /** A per-proposal tip is still a note; the trainer owns the list that shows it. */
  onNoteAdded: (note: SavedNote) => void;
}) {
  const [slate, setSlate] = useState(initialSlate);
  const [pending, setPending] = useState(initialPending);
  const [rejected, setRejected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [tipFor, setTipFor] = useState<string | null>(null);

  const { context, proposals } = slate;

  // Resolved client-side: which calendar day this is, is a question only the
  // user's timezone can answer. The server clock would push an evening log onto
  // tomorrow — and fetch tomorrow's forecast with it.
  const today = wornOnToISODate(wornOnFromLocalDate(new Date()));

  const otherItemIds = useCallback(
    (key: string) => proposals.filter((p) => p.key !== key).flatMap((p) => p.items.map((i) => i.id)),
    [proposals],
  );

  const refresh = useCallback(
    (nextRejected: string[]) => {
      startTransition(async () => {
        const next = await getDailySlate(nextRejected, today);
        setSlate(next);
        if (next.proposals.length === 0) {
          setNote("That's everything your closet can put together today.");
        }
      });
    },
    [today],
  );

  /**
   * Pull the weather again on mount, passing the local date.
   *
   * The server rendered this page with its own idea of "today", which is the
   * wrong day for anyone west of UTC after their afternoon. This is also what
   * refreshes a forecast that was cached before the user left the tab open
   * overnight.
   */
  useEffect(() => {
    startTransition(async () => {
      const next = await getDailySlate([], today);
      setSlate(next);
    });
  }, [today]);

  function learned(message: string) {
    setNote(message);
    onModelChanged();
  }

  function onWear(key: string, occasion: Occasion) {
    const proposal = proposals.find((p) => p.key === key);
    if (!proposal) return;
    startTransition(async () => {
      await acceptProposal({
        chosenIds: proposal.items.map((i) => i.id),
        rejectedIds: otherItemIds(key),
        propensity: proposal.propensity,
        strategy: proposal.strategy,
        occasion,
        wornOnISO: today,
      });
      setConfirming(null);
      learned("Logged. That's one more real example for the model.");
    });
  }

  function onReroll() {
    const shown = proposals.flatMap((p) => p.items.map((i) => i.id));
    const next = [...new Set([...rejected, ...shown])];
    setRejected(next);
    startTransition(async () => {
      await rerollProposal({ chosenIds: [], rejectedIds: shown, propensity: null });
      const fresh = await getDailySlate(next, today);
      setSlate(fresh);
      onModelChanged();
      if (fresh.proposals.length === 0) {
        setNote("Nothing left that's meaningfully different — try again tomorrow.");
      }
    });
  }

  function onDismiss() {
    const shown = proposals.flatMap((p) => p.items.map((i) => i.id));
    startTransition(async () => {
      await dismissSlate({ chosenIds: [], rejectedIds: shown, propensity: null });
      learned("Noted — none of these.");
    });
  }

  function onSaveLocation(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await setHomeLocation(trimmed);
      // Re-pull rather than patching the band locally: the forecast is the
      // server's to fetch, and a stale band would keep steering the scorer.
      const next = await getDailySlate(rejected, today);
      setSlate(next);
      onModelChanged();
    });
  }

  function onTip(key: string, text: string) {
    const proposal = proposals.find((p) => p.key === key);
    if (!proposal || !text.trim()) return;
    startTransition(async () => {
      // The garments on screen go with the note — that is what lets "that hat"
      // resolve to an id without any pronoun guesswork.
      const result = await addStyleNote(text, proposal.items.map((i) => i.id));
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      onNoteAdded(result.note);
      setTipFor(null);
      setNote(
        result.understood
          ? result.note.summary || "Got it — I'll keep that in mind."
          : "Saved, though I couldn't turn that into a rule yet.",
      );
      refresh(rejected);
      onModelChanged();
    });
  }

  function onConfirmWear(id: string, occasion: Occasion) {
    startTransition(async () => {
      await confirmPendingWear(id, occasion);
      setPending((prev) => prev.filter((p) => p.id !== id));
      onModelChanged();
    });
  }

  function onRejectWear(id: string) {
    startTransition(async () => {
      await rejectPendingWear(id);
      setPending((prev) => prev.filter((p) => p.id !== id));
    });
  }

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(timer);
  }, [note]);

  return {
    context,
    proposals,
    pending,
    busy,
    note,
    confirming,
    setConfirming,
    tipFor,
    setTipFor,
    onWear,
    onReroll,
    onDismiss,
    onSaveLocation,
    onRefresh: () => refresh(rejected),
    onTip,
    onConfirmWear,
    onRejectWear,
  };
}

export type DailySlateState = ReturnType<typeof useDailySlate>;

/**
 * Today's three looks, full width beneath the builder's columns.
 *
 * Wide rather than tucked in a sidebar because this is where the training data
 * comes from: "Wearing this" writes a confidence-1 wear *and* `chosen ≻ the
 * other two` under identical context, which is the single most informative event
 * the model ever sees. Cramped into 300px it read as a widget; across the page
 * it reads as the question it is.
 */
export function TodaysPicks({ daily }: { daily: DailySlateState }) {
  const {
    proposals,
    pending,
    busy,
    note,
    confirming,
    setConfirming,
    tipFor,
    setTipFor,
    onWear,
    onReroll,
    onDismiss,
    onTip,
    onConfirmWear,
    onRejectWear,
  } = daily;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl">Today&rsquo;s picks</h2>
          <span className="text-xs text-ink-muted">
            Tell me which one you wear and everything else here gets better.
          </span>
        </div>

        {note ? (
          <p aria-live="polite" className="mt-3 rounded-xl bg-paper-warm px-3 py-2 text-xs text-ink-muted">
            {note}
          </p>
        ) : null}

        {proposals.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {proposals.map((proposal, index) => (
              <li key={proposal.key} className="rounded-xl border border-ink/10 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">
                    {STRATEGY_LABEL[proposal.strategy] ?? `Option ${index + 1}`}
                  </h3>
                  <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                    {proposal.items.length} pieces
                  </span>
                </div>

                <ul className="mt-2 flex flex-wrap gap-2">
                  {proposal.items.map((item) => (
                    <li key={item.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl(item.imagePath)}
                        alt={item.name}
                        title={item.name}
                        className="h-20 w-20 rounded-lg border border-ink/10 bg-paper object-cover"
                      />
                    </li>
                  ))}
                </ul>

                {confirming === proposal.key ? (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-muted">What for?</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {OCCASIONS.map((occasion) => (
                        <button
                          key={occasion}
                          type="button"
                          disabled={busy}
                          onClick={() => onWear(proposal.key, occasion)}
                          className="rounded-full border border-ink/15 bg-white px-2.5 py-0.5 text-[11px] text-ink transition hover:bg-paper-warm disabled:opacity-50"
                        >
                          {OCCASION_LABELS[occasion]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming(proposal.key)}
                      className="rounded-full border border-ink bg-ink px-3.5 py-1 text-xs text-paper transition hover:opacity-90 disabled:opacity-50"
                    >
                      Wearing this
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setTipFor(tipFor === proposal.key ? null : proposal.key)}
                      className="text-xs text-ink-muted underline disabled:opacity-50"
                    >
                      Any tips?
                    </button>
                  </div>
                )}

                {tipFor === proposal.key ? (
                  <TipBox busy={busy} onSubmit={(text) => onTip(proposal.key, text)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {proposals.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onReroll}
              className="rounded-full border border-ink/15 bg-white px-4 py-1.5 text-xs text-ink transition hover:bg-paper-warm disabled:opacity-50"
            >
              Something else
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDismiss}
              className="rounded-full border border-ink/15 bg-white px-4 py-1.5 text-xs text-ink-muted transition hover:bg-paper-warm disabled:opacity-50"
            >
              None of these
            </button>
          </div>
        ) : null}
      </section>

      {pending.length > 0 ? (
        <PendingWears
          pending={pending}
          busy={busy}
          onConfirm={onConfirmWear}
          onReject={onRejectWear}
        />
      ) : null}
    </div>
  );
}

/**
 * Where you get dressed, and what it's doing there.
 *
 * Says which of the three things it is — a real forecast, a historical average,
 * or nothing at all — because the scorer treats a missing band as neutral rather
 * than guessing, and the user should know when suggestions are weather-blind.
 */
export function WeatherCard({
  daily,
  temperatureUnit,
}: {
  daily: DailySlateState;
  temperatureUnit: TemperatureUnit;
}) {
  const { context, busy, onSaveLocation: onSave, onRefresh } = daily;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const known = context.band && context.highC != null;

  if (known && !editing) {
    return (
      <section className="rounded-2xl border border-ink/10 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg">
            {BAND_COPY[context.band!] ?? context.band} · {formatTemperature(context.highC!, temperatureUnit)}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            className="text-[11px] text-ink-muted underline disabled:opacity-50"
          >
            {busy ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {context.location}
          {context.rainChance != null ? ` · ${Math.round(context.rainChance * 100)}% rain` : null}
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {context.source === "forecast"
            ? "Live forecast — factored into every suggestion here."
            : context.source === "manual"
              ? "You set this."
              : "From past records, not a forecast."}{" "}
          <button
            type="button"
            onClick={() => {
              setDraft(context.location ?? "");
              setEditing(true);
            }}
            className="underline hover:text-ink"
          >
            Change
          </button>
        </p>
      </section>
    );
  }

  // No location, or the provider had nothing. Say so plainly rather than
  // dressing the user for a climate nobody measured.
  return (
    <section className="rounded-2xl border border-ink/10 bg-paper-warm p-4">
      <h2 className="font-serif text-lg">Weather</h2>
      <p className="mt-1 text-xs text-ink-muted">
        {editing
          ? "Somewhere else today?"
          : context.source === "unknown"
            ? `Couldn't get today's weather for ${context.location}. Suggestions ignore it for now.`
            : "Tell me where you get dressed and I'll factor in the weather."}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={context.location ?? "San Diego"}
          aria-label="Home location"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onSave(draft);
          }}
          disabled={busy || !draft.trim()}
          className="rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper transition hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-ink-muted underline"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One-off tip capture, attached to the outfit it is about. Free text rather than
 * a form: the point is that the user says the thing in their own words and the
 * parser does the classifying.
 */
function TipBox({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");

  return (
    <div className="mt-2 rounded-xl border border-ink/10 bg-paper-warm p-2.5">
      <label className="block text-[10px] uppercase tracking-wide text-ink-muted">
        Anything I should know about this one?
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
        rows={2}
        placeholder="Don't put that hat with that shirt."
        aria-label="Tip about this outfit"
        className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-xs focus:border-ink/40 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSubmit(text)}
          className="rounded-full border border-ink bg-ink px-3 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Save tip
        </button>
        <span className="ml-auto text-[10px] text-ink-muted">
          {text.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-ink/15 p-4 text-center">
      <p className="text-xs text-ink">Not enough to build a full outfit yet.</p>
      <p className="mt-1 text-[11px] text-ink-muted">
        A proposal needs a top, a bottom and shoes.{" "}
        <Link href="/closet/add" className="underline">
          Add a few pieces
        </Link>
        .
      </p>
    </div>
  );
}

function PendingWears({
  pending,
  busy,
  onConfirm,
  onReject,
}: {
  pending: PendingWear[];
  busy: boolean;
  onConfirm: (id: string, occasion: Occasion) => void;
  onReject: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink">Did you wear these?</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Spotted in your photos. Confirming turns a guess into a real record.
      </p>
      <ul className="mt-3 space-y-3">
        {pending.map((wear) => (
          <li key={wear.id} className="rounded-xl border border-ink/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-muted">{wear.wornOnISO}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject(wear.id)}
                className="text-[11px] text-ink-muted underline disabled:opacity-50"
              >
                Not me
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {wear.items.map((item) => (
                <li key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item.imagePath)}
                    alt={item.name}
                    className="h-12 w-12 rounded-lg border border-ink/10 bg-paper object-cover"
                  />
                </li>
              ))}
            </ul>
            {open === wear.id ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OCCASIONS.map((occasion) => (
                  <button
                    key={occasion}
                    type="button"
                    disabled={busy}
                    onClick={() => onConfirm(wear.id, occasion)}
                    className="rounded-full border border-ink/15 px-2.5 py-0.5 text-[11px] transition hover:bg-paper-warm disabled:opacity-50"
                  >
                    {OCCASION_LABELS[occasion]}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(wear.id)}
                className="mt-2 rounded-full border border-ink bg-ink px-3 py-1 text-[11px] text-paper disabled:opacity-50"
              >
                Yes — what for?
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
