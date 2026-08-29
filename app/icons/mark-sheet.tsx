/**
 * The five candidate marks, side by side, at the sizes that decide it.
 *
 * A logo is chosen at 16px and at 64px, on both backdrops, next to the wordmark
 * it has to sit beside — not in isolation at 400px where everything looks fine.
 * So every variant is shown four times.
 *
 * The Space column works by nesting a `.dark` element rather than by switching
 * the app's theme: `.dark` only re-binds the palette custom properties (see
 * app/globals.css), so anything inside it renders in night colours while the
 * rest of the page stays on paper. That is the only honest way to compare them
 * on one screen.
 *
 * Delete this file when a variant wins — along with the other four and
 * `BrandMark`'s `variant` prop.
 */

import {
  BrandMark,
  BRAND_MARK_VARIANTS,
  type BrandMarkVariant,
} from "@/components/brand-mark";
import { Wordmark } from "@/components/wordmark";

/** The sizes that actually matter: favicon, chrome, and a look at the drawing. */
const SIZES = [16, 24, 64] as const;

export function MarkSheet() {
  return (
    <section>
      <h2 className="font-serif text-3xl tracking-tight">Marks</h2>
      <p className="mt-2 max-w-xl text-ink-muted">
        Five takes on one idea: two slabs, and the gap between them is the
        subject. Same slab geometry in all five — only the treatment of the space
        changes.
      </p>

      <ul className="mt-8 space-y-4">
        {BRAND_MARK_VARIANTS.map((variant) => (
          <li
            key={variant.id}
            className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-tile"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-[12rem]">
                <h3 className="font-medium">{variant.label}</h3>
                <p className="mt-1 max-w-sm text-xs text-ink-muted">{variant.note}</p>
                <code className="mt-2 block text-[11px] text-ink-muted">
                  {`<BrandMark variant="${variant.id}" />`}
                </code>
              </div>

              {/*
                Both backdrops, side by side. `light` and `dark` re-bind the
                palette locally (see app/globals.css), so each box renders in its
                own mode whichever mode the surrounding page is in — which is the
                only way to review a two-colour mark on one screen.
              */}
              <div className="flex flex-wrap gap-3">
                <Swatch mode="light" variant={variant.id} />
                <Swatch mode="dark" variant={variant.id} />
              </div>
            </div>

            {/* Beside the name, which is where it will actually live. */}
            <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-ink/10 pt-4">
              <span className="inline-flex items-center gap-2.5 text-ink-muted">
                <BrandMark variant={variant.id} size={18} />
                <Wordmark
                  piecesOut={0}
                  className="font-sans text-[11px] font-medium uppercase tracking-[0.2em]"
                />
              </span>
              <span className="inline-flex items-center gap-2.5 text-ink-muted">
                <BrandMark variant={variant.id} size={18} />
                <Wordmark
                  piecesOut={9}
                  className="font-sans text-[11px] font-medium uppercase tracking-[0.2em]"
                />
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* The gap widening is the part of the wordmark nobody can review from a
          single sample, so here is the whole curve at once. */}
      <div className="mt-8 rounded-2xl border border-ink/10 bg-paper-warm p-5">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">
          The gap, by pieces out
        </h3>
        <ul className="mt-3 space-y-1.5">
          {[0, 1, 3, 6, 12, 24, 60].map((n) => (
            <li key={n} className="flex items-baseline gap-4">
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
                {n}
              </span>
              <Wordmark
                piecesOut={n}
                className="font-sans text-sm font-medium uppercase tracking-[0.2em]"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** One backdrop's worth of the mark, at every size that decides it. */
function Swatch({ mode, variant }: { mode: "light" | "dark"; variant: BrandMarkVariant }) {
  return (
    <div className={`${mode} rounded-xl bg-paper px-5 py-4`}>
      <div className="flex items-end gap-5">
        {SIZES.map((size) => (
          <span key={size} className="flex flex-col items-center gap-2 text-ink">
            <BrandMark variant={variant} size={size} />
            <span className="text-[10px] tabular-nums text-ink-muted">{size}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-center text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        {mode === "dark" ? "Space" : "Paper"}
      </p>
    </div>
  );
}
