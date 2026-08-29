"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/sale-listing";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import { PRIORITY_OPTIONS, PRIORITY_WANT, centsToInput } from "@/lib/wishlist/priority";
import {
  addFromSearchMatch,
  addWishlistItem,
  previewFromUrl,
  searchProducts,
  type WishlistPreview,
} from "./actions";

type Mode = "link" | "search";

export function AddPanel({ wantCategory }: { wantCategory?: string | null }) {
  const router = useRouter();
  /*
   * Arriving from an empty outfit slot means the shape is already known but the
   * garment is not, so search-by-name is the only mode that can help — a link
   * you don't have yet cannot be pasted. `useState` initialiser rather than an
   * effect: the mode is right on first paint and never flips under the user.
   */
  const [mode, setMode] = useState<Mode>(wantCategory ? "search" : "link");
  const [priority, setPriority] = useState<number>(PRIORITY_WANT);

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface p-6 shadow-tile">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">Add something you want</h2>
        <div className="flex rounded-full bg-paper-warm p-0.5 text-xs">
          <TabButton active={mode === "link"} onClick={() => setMode("link")}>
            Paste a link
          </TabButton>
          <TabButton active={mode === "search"} onClick={() => setMode("search")}>
            Search by name
          </TabButton>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">Priority</span>
        {PRIORITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPriority(opt.value)}
            title={opt.hint}
            className={`rounded-full px-3 py-1 text-xs tracking-wide transition ${
              priority === opt.value
                ? "bg-ink text-paper"
                : "bg-paper-warm text-ink-muted hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/*
        Phrased without an article on purpose. Categories are user-named and
        arrive in every shape — "jacket", "jeans", "outerwear" — so "asked for a
        {category}" produced "asked for a jeans". "A piece filed under X" is
        grammatical whatever X turns out to be, and it also happens to be the
        exact relationship being described.
      */}
      {wantCategory ? (
        <p className="mt-3 rounded-xl bg-accent/15 px-3 py-2 text-xs text-ink">
          An outfit rule wanted a piece filed under{" "}
          <span className="lowercase">{wantCategory}</span>, and your closet had none.
        </p>
      ) : null}

      {mode === "link" ? (
        <LinkForm priority={priority} onAdded={() => router.refresh()} />
      ) : (
        <SearchForm
          priority={priority}
          initialQuery={wantCategory ?? ""}
          onAdded={() => router.refresh()}
        />
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 transition ${
        active ? "bg-surface text-ink shadow-tile" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- link */

function LinkForm({ priority, onAdded }: { priority: number; onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<WishlistPreview | null>(null);
  const [manualPrice, setManualPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    setPreview(null);
    const res = await previewFromUrl(url);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res.value);
    setManualPrice(centsToInput(res.value.priceCents));
  }

  async function confirm() {
    if (!preview) return;
    const typed = Number(manualPrice.replace(/[^0-9.]/g, ""));
    const priceCents =
      Number.isFinite(typed) && typed > 0 ? Math.round(typed * 100) : preview.priceCents;

    setBusy(true);
    setError(null);
    const res = await addWishlistItem({
      name: preview.name,
      brand: preview.brand,
      priceCents,
      currency: preview.currency,
      retailer: preview.retailer,
      productUrl: preview.productUrl,
      imageUrl: preview.imageUrl,
      priority,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setUrl("");
    setPreview(null);
    setManualPrice("");
    onAdded();
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load();
          }}
          placeholder="https://www.everlane.com/products/…"
          className="min-w-[16rem] flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={load}
          disabled={busy || !url.trim()}
          className="rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy ? "Reading…" : "Look it up"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {preview ? (
        <div className="mt-5 flex flex-wrap gap-5 rounded-xl bg-paper-warm p-4 sm:flex-nowrap">
          {preview.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.imageUrl}
              alt=""
              className="h-32 w-32 shrink-0 rounded-lg bg-surface object-contain"
            />
          ) : (
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-surface text-xs text-ink-muted">
              No photo
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{preview.name}</p>
            <p className="text-sm text-ink-muted">
              {[preview.brand, preview.retailer].filter(Boolean).join(" · ") || "—"}
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="preview-price"
                  className="block text-[11px] uppercase tracking-wide text-ink-muted"
                >
                  Price
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                    $
                  </span>
                  <input
                    id="preview-price"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="—"
                    className="w-32 rounded-xl border border-ink/15 bg-paper py-2 pl-7 pr-3 text-sm focus:border-ink/40 focus:outline-none"
                  />
                </div>
              </div>
              <PriceSourceNote source={preview.priceSource} />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
              >
                {busy ? "Adding…" : "Add to wishlist"}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-sm text-ink-muted hover:text-ink"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PriceSourceNote({ source }: { source: WishlistPreview["priceSource"] }) {
  if (source === "merchant") {
    return <p className="pb-2 text-xs text-ink-muted">Read from the store page.</p>;
  }
  if (source === "shopping-search") {
    return (
      <p className="pb-2 text-xs text-amber-800">
        The store page didn&apos;t list a price — this one came from Google Shopping. Worth a check.
      </p>
    );
  }
  return <p className="pb-2 text-xs text-amber-800">No price found. Type it in yourself.</p>;
}

/* ----------------------------------------------------------------- search */

function SearchForm({
  priority,
  onAdded,
  initialQuery = "",
}: {
  priority: number;
  onAdded: () => void;
  /** Prefilled from ?want=, so the field opens with the shape already typed. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ProductMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await searchProducts(query);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setResults(null);
      return;
    }
    setResults(res.value);
  }

  async function add(match: ProductMatch) {
    setAddingUrl(match.url);
    setError(null);
    const res = await addFromSearchMatch(match, priority);
    setAddingUrl(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onAdded();
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Adidas Sambas, black"
          className="min-w-[16rem] flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !query.trim()}
          className="rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {results && results.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">Nothing came back. Try different words.</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((match) => (
            <li
              key={`${match.url}-${match.name}`}
              className="flex gap-3 rounded-xl bg-paper-warm p-3"
            >
              {match.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={match.thumbnailUrl}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-lg bg-surface object-contain"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface text-[10px] text-ink-muted">
                  No photo
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="line-clamp-2 text-sm font-medium">{match.name}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{match.retailer}</p>
                <p className="mt-1 text-sm tabular-nums">
                  {match.priceCents > 0 ? formatCents(match.priceCents, match.currency) : "—"}
                </p>
                <button
                  type="button"
                  onClick={() => add(match)}
                  disabled={addingUrl === match.url}
                  className="mt-auto self-start pt-2 text-xs underline text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  {addingUrl === match.url ? "Adding…" : "Add to wishlist"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
