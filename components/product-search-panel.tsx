"use client";

import { useState, useTransition } from "react";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";

type Props = {
  title?: string;
  hint?: string;
  query: string;
  onQueryChange: (query: string) => void;
  results: ProductMatch[];
  onResultsChange: (results: ProductMatch[]) => void;
  onSearch: (query: string) => Promise<ProductMatch[]>;
  onSelect: (match: ProductMatch) => void;
  selectedUrl?: string | null;
  onClearSelection?: () => void;
};

export function ProductSearchPanel({
  title = "Find product online",
  hint,
  query,
  onQueryChange,
  results,
  onResultsChange,
  onSearch,
  onSelect,
  selectedUrl,
  onClearSelection,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  const selectedMatch = selectedUrl ? results.find((m) => m.url === selectedUrl) : null;

  function runSearch() {
    const q = query.trim();
    if (!q) return;
    setError(null);
    startSearch(async () => {
      try {
        const found = await onSearch(q);
        onResultsChange(found);
        if (found.length === 0) {
          setError("No products found. Try different keywords.");
        }
      } catch (err) {
        setError((err as Error).message ?? "Search failed");
        onResultsChange([]);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-warm p-4 space-y-3">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">{title}</h3>
        {hint && <p className="text-[11px] text-ink-muted mt-1">{hint}</p>}
      </div>

      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder="Brand, name, color, category…"
          autoComplete="off"
          className="flex-1 text-sm rounded-xl border border-ink/15 px-3 py-2 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || !query.trim()}
          className="rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50 shrink-0"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-red-700">
          {error}
        </p>
      )}

      {selectedUrl && onClearSelection && (
        <div className="flex items-center gap-2 rounded-xl border border-ink/15 bg-surface px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted">Selected listing</p>
            <p className="text-xs truncate">{selectedMatch?.name ?? "Product"}</p>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper-warm transition shrink-0"
          >
            Clear · browse results
          </button>
        </div>
      )}

      {results.length > 0 && (
        <>
          {/*
            The count, because the list now has depth worth knowing about.
            Google Shopping returns roughly forty to sixty rows per search and
            all of them are kept — the old `.slice(0, 12)` in
            lib/services/webProductSearch.ts discarded the rest *after* the
            request had already been billed, so scrolling the full set costs
            nothing extra. Saying how many there are is what turns a grid that
            looks complete into one the user knows to scroll.
          */}
          <p className="text-[11px] text-ink-muted">
            {results.length} {results.length === 1 ? "result" : "results"} · scroll for more,
            no further searches
          </p>

          {/*
            A grid rather than a list of rows. The old layout gave each result a
            48px square with object-cover, which both shrank the photo and
            cropped it — you could not tell a full product shot from a detail
            crop, which is the only judgement that matters when picking a
            reference. Thumbnails come back 245–686px square, so a ~180px tile
            is well within their resolution.
          */}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-h-[26rem] overflow-y-auto pr-1">
            {results.map((m) => {
              const selected = selectedUrl === m.url;
              return (
                <li key={m.url}>
                  <button
                    type="button"
                    onClick={() => onSelect(m)}
                    className={`group w-full overflow-hidden rounded-xl border bg-surface text-left transition ${
                      selected
                        ? "border-ink ring-1 ring-ink"
                        : "border-ink/10 hover:border-ink/30"
                    }`}
                  >
                    <div className="relative aspect-square bg-paper-warm">
                      {m.thumbnailUrl ? (
                        // object-contain, not cover: the whole product has to be
                        // visible for the user to judge whether it is a usable
                        // reference. Padding keeps it off the tile edge.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-contain p-2 transition group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-muted">
                          no photo
                        </div>
                      )}
                      {selected && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-ink px-2 py-0.5 text-[10px] uppercase tracking-wide text-paper">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 border-t border-ink/10 px-2.5 py-2">
                      <div className="line-clamp-2 text-xs leading-snug">{m.name}</div>
                      {/*
                        Price on its own row and never truncated. Sharing a line
                        with the retailer meant a long seller name ("Joe's New
                        Balance Outlet") clipped the price to "$109…", losing the
                        one number the user is comparing across results.
                      */}
                      <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-muted">
                        <span className="truncate">{m.retailer}</span>
                        {m.priceCents > 0 && (
                          <span className="shrink-0 tabular-nums text-ink">
                            {formatPrice(m.priceCents, m.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/*
            What actually makes a good reference, which is not what people
            assume. A single shoe is fine: the ghost prompt treats the reference
            as identity-only and rebuilds the pair, verified against a toe-on
            single-shoe listing. Resolution and a clean background are what carry
            through, so that is what the hint points at.
          */}
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Pick the clearest photo of the item itself — sharp, well lit, plain
            background, nothing else in frame. A single shoe is fine; the catalog
            render rebuilds the pair. Avoid photos worn by a model, flat-lays with
            props, or collages.
          </p>
        </>
      )}

    </div>
  );
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
