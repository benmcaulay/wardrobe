"use client";

/**
 * Outfit instructions for this session, in plain English.
 *
 * Collapsible because it is empty most of the time and the outfits page is
 * already dense; it opens itself as soon as there is something to show, so an
 * active instruction is never hidden behind a closed panel.
 *
 * Distinct from Styling Tips on purpose. A tip is a standing fact about how
 * someone dresses and is stored; these are a mood for the next ten minutes and
 * vanish with the page — the copy has to make that difference obvious, or
 * people will type long-term preferences in here and lose them.
 */

import { useState } from "react";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";
import type { DirectiveMiss, SessionDirective } from "@/lib/outfit/directives";

export type DirectiveChip = {
  directive: SessionDirective;
  summary: string;
  /** Why the last spin could not honour it, or null when it did. */
  miss: DirectiveMiss | null;
};

/**
 * Naming the actual obstacle. "Nothing matches" against a closet holding five
 * red hats is worse than saying nothing — it sends someone to fix the wrong
 * thing. The real cause there is a layout with no hat slot.
 */
const MISS_COPY: Record<DirectiveMiss, string> = {
  no_match: "nothing in your closet matches",
  no_slot: "no slot for that \u2014 add one to your layout",
  not_this_time: "couldn\u2019t fit it this time",
};

export function SessionDirectives({
  directives,
  busy,
  error,
  onAdd,
  onRemove,
}: {
  directives: DirectiveChip[];
  busy: boolean;
  error: string | null;
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const expanded = open || directives.length > 0;

  function submit() {
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText("");
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface shadow-tile">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <h3 className="font-serif text-lg">Just for now</h3>
        {directives.length > 0 ? (
          <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">
            {directives.length}
          </span>
        ) : null}
        <span aria-hidden className="ml-auto text-xs text-ink-muted">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-ink/10 px-4 pb-4 pt-3">
          <p className="text-xs text-ink-muted">
            Steer the next few outfits &mdash; &ldquo;a red hat&rdquo;, &ldquo;keep it
            formal&rdquo;. These fade when you leave the page. For something you always
            want, use Styling Tips instead.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="I want a red hat"
              aria-label="Outfit instruction for this session"
              className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={submit}
              className="shrink-0 rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper disabled:opacity-40"
            >
              {busy ? "Reading…" : "Apply"}
            </button>
          </div>

          {error ? <p className="mt-2 text-xs text-[--danger]">{error}</p> : null}

          {directives.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {directives.map((chip) => (
                <li
                  key={chip.directive.id}
                  className="flex items-start justify-between gap-2 rounded-xl bg-paper px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{chip.summary}</p>
                    <p className="truncate text-[11px] text-ink-muted">
                      &ldquo;{chip.directive.text}&rdquo;
                      {chip.miss ? ` \u2014 ${MISS_COPY[chip.miss]}` : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(chip.directive.id)}
                    aria-label={`Remove: ${chip.summary}`}
                    className="shrink-0 text-[11px] text-ink-muted underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
