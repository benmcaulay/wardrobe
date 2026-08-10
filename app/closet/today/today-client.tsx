"use client";

/**
 * The daily proposal surface (docs/OUTFIT_INTELLIGENCE.md §5B).
 *
 * Three options rather than one, deliberately: a single suggestion has to be
 * right or it is worthless, and three let the user choose — which is both
 * kinder and far more informative, because a pick is `chosen ≻ the rest` under
 * identical context.
 *
 * Every button here writes training data. "Wearing this" is a confidence-1 wear
 * plus a comparison; "Something else" is the comparison alone. The occasion
 * chips exist because this prompt is the only place occasion labels come from.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { imageUrl } from "@/lib/image-paths";
import { OCCASIONS, OCCASION_LABELS, type Occasion } from "@/lib/wear/occasions";
import { wornOnFromLocalDate, wornOnToISODate } from "@/lib/wear/rollup";
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
import { addStyleNote, deactivateStyleNote, type SavedNote } from "@/lib/actions/style-notes";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";
import { TrainingPanel } from "./training-panel";

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

export function TodayClient({
  initialSlate,
  initialPending,
  initialNotes,
}: {
  initialSlate: DailySlateResponse;
  initialPending: PendingWear[];
  initialNotes: SavedNote[];
}) {
  const [slate, setSlate] = useState(initialSlate);
  const [pending, setPending] = useState(initialPending);
  const [rejected, setRejected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<SavedNote[]>(initialNotes);
  const [tipFor, setTipFor] = useState<string | null>(null);

  const { context, proposals } = slate;

  // Resolved client-side: which calendar day a wear belongs to is a question
  // only the user's timezone can answer, and the server clock would push an
  // evening log onto tomorrow.
  const today = wornOnToISODate(wornOnFromLocalDate(new Date()));

  const otherItemIds = useCallback(
    (key: string) => proposals.filter((p) => p.key !== key).flatMap((p) => p.items.map((i) => i.id)),
    [proposals],
  );

  function refresh(nextRejected: string[]) {
    startTransition(async () => {
      const next = await getDailySlate(nextRejected);
      setSlate(next);
      if (next.proposals.length === 0) {
        setNote("That's everything your closet can put together today.");
      }
    });
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
      setNote("Logged. That's one more real example for the model.");
    });
  }

  function onReroll() {
    const shown = proposals.flatMap((p) => p.items.map((i) => i.id));
    const next = [...new Set([...rejected, ...shown])];
    setRejected(next);
    startTransition(async () => {
      await rerollProposal({ chosenIds: [], rejectedIds: shown, propensity: null });
      const fresh = await getDailySlate(next);
      setSlate(fresh);
      if (fresh.proposals.length === 0) {
        setNote("Nothing left that's meaningfully different — try again tomorrow.");
      }
    });
  }

  function onDismiss() {
    const shown = proposals.flatMap((p) => p.items.map((i) => i.id));
    startTransition(async () => {
      await dismissSlate({ chosenIds: [], rejectedIds: shown, propensity: null });
      setNote("Noted — none of these.");
    });
  }

  function onSaveLocation() {
    const value = locationDraft.trim();
    if (!value) return;
    startTransition(async () => {
      await setHomeLocation(value);
      refresh(rejected);
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
      setNotes((prev) => [result.note, ...prev]);
      setTipFor(null);
      setNote(
        result.understood
          ? result.note.summary || "Got it — I'll keep that in mind."
          : "Saved, though I couldn't turn that into a rule yet.",
      );
      refresh(rejected);
    });
  }

  function onGeneralTip(text: string) {
    if (!text.trim()) return;
    startTransition(async () => {
      // No subjects: the action reads that as closet scope, so a habit like
      // "I don't wear boots with shorts" resolves against the whole wardrobe
      // rather than whatever happens to be on screen.
      const result = await addStyleNote(text, []);
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setNotes((prev) => [result.note, ...prev]);
      setNote(
        result.understood
          ? result.note.summary || "Got it — that's a standing rule now."
          : "Saved, though I couldn't turn that into a rule yet.",
      );
      refresh(rejected);
    });
  }

  function onForgetNote(id: string) {
    startTransition(async () => {
      await deactivateStyleNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      refresh(rejected);
    });
  }

  function onConfirmWear(id: string, occasion: Occasion) {
    startTransition(async () => {
      await confirmPendingWear(id, occasion);
      setPending((prev) => prev.filter((p) => p.id !== id));
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

  return (
    <div className="space-y-6">
      <GeneralTipBox busy={busy} onSubmit={onGeneralTip} />

      <ContextBar
        context={context}
        draft={locationDraft}
        onDraft={setLocationDraft}
        onSave={onSaveLocation}
        busy={busy}
      />

      {note ? (
        <p aria-live="polite" className="rounded-xl bg-paper-warm px-3 py-2 text-xs text-ink-muted">
          {note}
        </p>
      ) : null}

      {proposals.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-4">
          {proposals.map((proposal, index) => (
            <li
              key={proposal.key}
              className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-ink">
                  {STRATEGY_LABEL[proposal.strategy] ?? `Option ${index + 1}`}
                </h2>
                <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                  {proposal.items.length} pieces
                </span>
              </div>

              <ul className="mt-3 flex flex-wrap gap-3">
                {proposal.items.map((item) => (
                  <li key={item.id} className="w-20 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(item.imagePath)}
                      alt={item.name}
                      className="h-20 w-20 rounded-xl border border-ink/10 bg-paper object-cover"
                    />
                    <span className="mt-1 block truncate text-[11px] text-ink-muted" title={item.name}>
                      {item.name}
                    </span>
                  </li>
                ))}
              </ul>

              {confirming === proposal.key ? (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted">What for?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {OCCASIONS.map((occasion) => (
                      <button
                        key={occasion}
                        type="button"
                        disabled={busy}
                        onClick={() => onWear(proposal.key, occasion)}
                        className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs text-ink transition hover:bg-paper-warm disabled:opacity-50"
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
                    className="rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper transition hover:opacity-90 disabled:opacity-50"
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
        <div className="flex flex-wrap gap-2">
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

      <TrainingPanel onLearned={() => refresh(rejected)} />

      {notes.length > 0 ? (
        <NotesList notes={notes} busy={busy} onForget={onForgetNote} />
      ) : null}

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
 * Standing rules — the general tip box.
 *
 * Sits at the top because this is where habits go: "I don't wear boots with
 * shorts", "no hats indoors". Those are statements about *kinds* of garment, so
 * they resolve against the whole wardrobe and keep applying to things bought
 * later — see the term-pair rules in lib/outfit/style-rules.ts.
 *
 * The contextual box on each proposal is still the better place for anything
 * about *specific* pieces, because there the parser knows exactly which
 * garments "that one" means. Both write the same kind of note.
 */
function GeneralTipBox({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-ink/20 px-3 py-2 text-left text-xs text-ink-muted transition hover:bg-paper-warm"
      >
        Any rules I should always follow? →
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink">Rules I should always follow</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Habits, not one-offs — &ldquo;I don&rsquo;t wear boots with shorts&rdquo;. These keep
        applying to pieces you buy later.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
        rows={2}
        placeholder="I don't wear boots with shorts."
        aria-label="Standing rule"
        className="mt-3 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => {
            onSubmit(text);
            setText("");
            setOpen(false);
          }}
          className="rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper disabled:opacity-40"
        >
          Save rule
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-muted underline"
        >
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-ink-muted">
          {text.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>
    </div>
  );
}

/**
 * One-off tip capture, attached to the outfit it is about.
 *
 * Deliberately a free-text box rather than a form: the whole point is that the
 * user says the thing in their own words, and the parser does the classifying.
 */
function TipBox({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="mt-3 rounded-xl border border-ink/10 bg-paper-warm p-3">
      <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
        Anything I should know about this one?
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
        rows={2}
        placeholder="Don't put that hat with that shirt."
        aria-label="Tip about this outfit"
        className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSubmit(text)}
          className="rounded-full border border-ink bg-ink px-3 py-1 text-xs text-paper disabled:opacity-40"
        >
          Save tip
        </button>
        <span className="ml-auto text-[11px] text-ink-muted">
          {text.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>
    </div>
  );
}

/** What the user has told me, in their words — with a way to take it back. */
function NotesList({
  notes,
  busy,
  onForget,
}: {
  notes: SavedNote[];
  busy: boolean;
  onForget: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink">What you&rsquo;ve told me</h2>
      <ul className="mt-2 space-y-2">
        {notes.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3">
            <p className="text-xs text-ink-muted">
              <span className="text-ink">&ldquo;{entry.text}&rdquo;</span>
              {entry.ruleCount === 0 ? " — not applied yet" : null}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => onForget(entry.id)}
              className="shrink-0 text-xs text-ink-muted underline disabled:opacity-50"
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContextBar({
  context,
  draft,
  onDraft,
  onSave,
  busy,
}: {
  context: DailySlateResponse["context"];
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (context.band && context.highC != null && !editing) {
    return (
      <p className="text-sm text-ink-muted">
        {BAND_COPY[context.band] ?? context.band} in {context.location} — around{" "}
        {Math.round(context.highC)}°C today.
        {context.source === "climatology" ? " (seasonal average, not a forecast)" : null}{" "}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="underline hover:text-ink"
        >
          Change
        </button>
      </p>
    );
  }

  // No location, or the provider had nothing. Say so plainly rather than
  // dressing the user for a climate nobody measured — the scorer treats an
  // absent band as neutral, so the suggestions are still sound, just
  // weather-blind.
  return (
    <div className="rounded-xl border border-ink/10 bg-paper-warm p-3">
      <p className="text-xs text-ink-muted">
        {editing
          ? "Somewhere else today?"
          : context.source === "unknown"
            ? `Couldn't get today's weather for ${context.location}. Suggestions ignore it for now.`
            : "Tell me where you usually get dressed and I'll factor in the weather."}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={context.location ?? "San Diego"}
          aria-label="Home location"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onSave();
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
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 p-6 text-center">
      <p className="text-sm text-ink">Not enough to build a full outfit yet.</p>
      <p className="mt-1 text-xs text-ink-muted">
        A proposal needs a top, a bottom and shoes.{" "}
        <Link href="/closet/add" className="underline">
          Add a few pieces
        </Link>{" "}
        and come back.
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
          <li key={wear.id} className="rounded-xl border border-ink/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-muted">{wear.wornOnISO}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject(wear.id)}
                className="text-xs text-ink-muted underline disabled:opacity-50"
              >
                Not me
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {wear.items.map((item) => (
                <li key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item.imagePath)}
                    alt={item.name}
                    className="h-14 w-14 rounded-lg border border-ink/10 bg-paper object-cover"
                  />
                </li>
              ))}
            </ul>
            {open === wear.id ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {OCCASIONS.map((occasion) => (
                  <button
                    key={occasion}
                    type="button"
                    disabled={busy}
                    onClick={() => onConfirm(wear.id, occasion)}
                    className="rounded-full border border-ink/15 px-3 py-1 text-xs transition hover:bg-paper-warm disabled:opacity-50"
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
                className="mt-2 rounded-full border border-ink bg-ink px-3 py-1 text-xs text-paper disabled:opacity-50"
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
