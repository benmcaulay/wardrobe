"use client";

/**
 * Styling tips, in the user's own words (docs/OUTFIT_INTELLIGENCE.md §9).
 *
 * Lives with the trainer because it is the same job by a different route: a
 * training round teaches by example, a tip teaches by instruction. "I don't wear
 * boots with shorts" is worth a hundred comparisons and takes one sentence, so it
 * belongs where someone has already decided to spend a minute teaching.
 *
 * Tips are stored verbatim and parsed into rules separately, which is why the
 * list can honestly say "not applied yet" — we kept what you said even when we
 * couldn't turn it into anything actionable.
 */

import { useState } from "react";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";
import type { SavedNote } from "@/lib/actions/style-notes";

export function StyleRulesPanel({
  notes,
  busy,
  onAdd,
  onForget,
}: {
  notes: SavedNote[];
  busy: boolean;
  onAdd: (text: string) => void;
  onForget: (id: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-tile">
      <h3 className="font-serif text-lg">Styling Tips</h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
        rows={2}
        placeholder="I don't wear boots with shorts."
        aria-label="Styling tip"
        className="mt-3 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => {
            onAdd(text);
            setText("");
          }}
          className="rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper disabled:opacity-40"
        >
          Save tip
        </button>
        <span className="ml-auto text-[11px] text-ink-muted">
          {text.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>

      {notes.length > 0 ? (
        <div className="mt-4 border-t border-ink/10 pt-3">
          <h4 className="text-[11px] uppercase tracking-wide text-ink-muted">
            What you&rsquo;ve told me
          </h4>
          <ul className="mt-2 space-y-2">
            {notes.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-2">
                <p className="text-xs text-ink-muted">
                  <span className="text-ink">&ldquo;{entry.text}&rdquo;</span>
                  {entry.ruleCount === 0 ? " — not applied yet" : null}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onForget(entry.id)}
                  className="shrink-0 text-[11px] text-ink-muted underline disabled:opacity-50"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
