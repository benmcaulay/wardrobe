"use client";

/**
 * Paper / Space / Match system.
 *
 * A three-way pill rather than a switch, because the third option is real:
 * `system` is the default and a two-state toggle would silently discard it the
 * first time anyone touched the control.
 *
 * Borrows the segmented-pill idiom already used for icon sizes
 * (app/icons/icon-gallery.tsx) so it doesn't arrive as a new kind of control.
 * The glyphs are the same day/night pair the landing hero toggles between, and
 * "Space" is deliberately not called "Dark" — see components/theme-provider.tsx.
 */

import { THEME_LABELS, useTheme, type Theme } from "@/components/theme-provider";

const ORDER: readonly Theme[] = ["paper", "space", "system"];

export function ThemeChoice({ className }: { className?: string }) {
  const { theme, resolved, setTheme, mounted } = useTheme();

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="Backdrop"
        className="flex rounded-full bg-paper-warm p-0.5 text-xs"
      >
        {ORDER.map((option) => {
          /*
           * Before mount nothing is marked selected. The stored choice is only
           * readable in an effect, so painting one of these as active on the
           * server would be a guess that flips a frame later — and a radio
           * group that changes its own answer on load is worse than one that
           * arrives blank for 16ms. The drawer this lives in starts closed, so
           * in practice nobody sees the blank state at all.
           */
          const active = mounted && theme === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition ${
                active ? "bg-surface text-ink shadow-tile" : "text-ink-muted hover:text-ink"
              }`}
            >
              {option === "paper" && <SunGlyph />}
              {option === "space" && <MoonGlyph />}
              {THEME_LABELS[option]}
            </button>
          );
        })}
      </div>
      {/*
        Only says anything when it has something to add: which backdrop
        `system` currently resolves to. Repeating "Paper mode" under a selected
        "Paper" button would be pure decoration.
      */}
      {mounted && theme === "system" ? (
        <p className="mt-1.5 px-1 text-[11px] text-ink-muted">
          Following your device — {resolved === "space" ? "Space" : "Paper"} right now.
        </p>
      ) : null}
    </div>
  );
}

function SunGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden focusable="false">
      <circle cx="6" cy="6" r="2.4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
        <path d="M6 0.8V2M6 10V11.2M0.8 6H2M10 6H11.2M2.3 2.3l0.85 0.85M8.85 8.85l0.85 0.85M9.7 2.3l-0.85 0.85M3.15 8.85l-0.85 0.85" />
      </g>
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden focusable="false">
      {/* A crescent as one path, so it fills cleanly at 12px instead of relying
          on a second shape to occlude the first. */}
      <path
        d="M9.4 7.9A4.2 4.2 0 0 1 4.1 2.6a4.4 4.4 0 1 0 5.3 5.3Z"
        fill="currentColor"
      />
    </svg>
  );
}
