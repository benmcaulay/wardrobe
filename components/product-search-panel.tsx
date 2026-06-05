"use client";

import { useEffect, useState, useTransition } from "react";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";

type Props = {
  title?: string;
  hint?: string;
  matches?: ProductMatch[];
  onSearch: (query: string) => Promise<ProductMatch[]>;
  onSelect: (match: ProductMatch) => void;
  selectedUrl?: string | null;
};

export function ProductSearchPanel({
  title = "Find product online",
  hint,
  matches: externalMatches,
  onSearch,
  onSelect,
  selectedUrl,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductMatch[]>(externalMatches ?? []);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (externalMatches?.length) setResults(externalMatches);
  }, [externalMatches]);

  const displayMatches = results;

  function runSearch() {
    const q = query.trim();
    if (!q) return;
    setError(null);
    startSearch(async () => {
      try {
        const found = await onSearch(q);
        setResults(found);
        if (found.length === 0) {
          setError("No products found. Try different keywords.");
        }
      } catch (err) {
        setError((err as Error).message ?? "Search failed");
        setResults([]);
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
          onChange={(e) => setQuery(e.target.value)}
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

      {displayMatches.length > 0 && (
        <ul className="max-h-64 overflow-y-auto space-y-2 pr-1">
          {displayMatches.map((m) => {
            const selected = selectedUrl === m.url;
            return (
              <li key={m.url}>
                <button
                  type="button"
                  onClick={() => onSelect(m)}
                  className={`w-full flex items-center gap-3 rounded-xl border p-2 text-left transition ${
                    selected
                      ? "border-ink bg-white ring-1 ring-ink"
                      : "border-ink/10 bg-white hover:border-ink/25"
                  }`}
                >
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-paper-warm flex-shrink-0">
                    {m.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-muted">
                        —
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{m.name}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {m.retailer}
                      {m.priceCents > 0
                        ? ` · ${formatPrice(m.priceCents, m.currency)}`
                        : ""}
                    </div>
                  </div>
                  {selected && (
                    <span className="text-[10px] uppercase tracking-wide text-ink-muted shrink-0">
                      Selected
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
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
