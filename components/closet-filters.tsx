"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CLOSET_SORT_OPTIONS, type ClosetSortKey } from "@/lib/closet-sort";
import { SEASONS } from "@/lib/types";

export type CategoryFilterOption = { value: string; label: string };

export type FilterOptions = {
  categories: CategoryFilterOption[];
  brands: string[];
  colors: string[];
  tags: string[];
};

export type ActiveFilters = {
  q: string;
  category: string;
  brand: string;
  color: string;
  season: string;
  tag: string;
  wishlist: boolean;
  sort: ClosetSortKey;
};

type Props = {
  options: FilterOptions;
  initial: ActiveFilters;
};

const DEBOUNCE_MS = 250;

/** Persisted when navigating away so “← Closet” can restore filters. */
const CLOSET_FILTERS_STORAGE_KEY = "wardrobe.closet.filters.v1";

function searchParamsHasActiveFilters(sp: URLSearchParams): boolean {
  return !!(
    sp.get("q")?.trim() ||
    sp.get("category") ||
    sp.get("brand") ||
    sp.get("color") ||
    sp.get("season") ||
    sp.get("tag") ||
    sp.get("wishlist") ||
    (sp.get("sort") && sp.get("sort") !== "newest")
  );
}

function persistClosetFilters(qsWithoutLeadingQuestion: string) {
  if (typeof window === "undefined") return;
  if (qsWithoutLeadingQuestion) {
    sessionStorage.setItem(CLOSET_FILTERS_STORAGE_KEY, qsWithoutLeadingQuestion);
  } else {
    sessionStorage.removeItem(CLOSET_FILTERS_STORAGE_KEY);
  }
}

export function ClosetFilters({ options, initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [brand, setBrand] = useState(initial.brand);
  const [color, setColor] = useState(initial.color);
  const [season, setSeason] = useState(initial.season);
  const [tag, setTag] = useState(initial.tag);
  const [wishlist, setWishlist] = useState(initial.wishlist);
  const [sort, setSort] = useState<ClosetSortKey>(initial.sort);

  const activeCount =
    (q ? 1 : 0) +
    (category ? 1 : 0) +
    (brand ? 1 : 0) +
    (color ? 1 : 0) +
    (season ? 1 : 0) +
    (tag ? 1 : 0) +
    (wishlist ? 1 : 0) +
    (sort !== "newest" ? 1 : 0);

  function push(next: Partial<ActiveFilters>) {
    const p = new URLSearchParams(searchParams.toString());
    const merged: ActiveFilters = { q, category, brand, color, season, tag, wishlist, sort, ...next };
    if (merged.q) p.set("q", merged.q);
    else p.delete("q");
    if (merged.category) p.set("category", merged.category);
    else p.delete("category");
    if (merged.brand) p.set("brand", merged.brand);
    else p.delete("brand");
    if (merged.color) p.set("color", merged.color);
    else p.delete("color");
    if (merged.season) p.set("season", merged.season);
    else p.delete("season");
    if (merged.tag) p.set("tag", merged.tag);
    else p.delete("tag");
    if (merged.wishlist) p.set("wishlist", "1");
    else p.delete("wishlist");
    if (merged.sort && merged.sort !== "newest") p.set("sort", merged.sort);
    else p.delete("sort");
    const qs = p.toString();
    persistClosetFilters(qs);
    router.replace(qs ? `/closet?${qs}` : "/closet", { scroll: false });
  }

  // Restore filters when returning via plain `/closet` links (e.g. item detail ← Closet).
  useEffect(() => {
    const current = new URLSearchParams(searchParams.toString());
    if (searchParamsHasActiveFilters(current)) {
      persistClosetFilters(current.toString());
      return;
    }
    const saved = sessionStorage.getItem(CLOSET_FILTERS_STORAGE_KEY);
    if (saved) {
      router.replace(`/closet?${saved}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for restore
  }, []);

  // Debounce the text-search push so every keystroke doesn't navigate.
  useEffect(() => {
    if (q === initial.q) return;
    const t = setTimeout(() => push({ q }), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function reset() {
    setQ("");
    setCategory("");
    setBrand("");
    setColor("");
    setSeason("");
    setTag("");
    setWishlist(false);
    setSort("newest");
    persistClosetFilters("");
    router.replace("/closet", { scroll: false });
  }

  return (
    <div className="mb-8 space-y-3">
      <div className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, brand, tags…"
          aria-label="Search wardrobe"
          className="w-full rounded-full border border-ink/10 bg-white px-5 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              push({ q: "" });
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Category"
          value={category}
          options={options.categories}
          onChange={(v) => {
            setCategory(v);
            push({ category: v });
          }}
        />
        <Select
          label="Brand"
          value={brand}
          options={options.brands.map((b) => ({ value: b, label: b }))}
          onChange={(v) => {
            setBrand(v);
            push({ brand: v });
          }}
          disabled={options.brands.length === 0}
        />
        <Select
          label="Color"
          value={color}
          options={options.colors.map((c) => ({ value: c, label: c }))}
          onChange={(v) => {
            setColor(v);
            push({ color: v });
          }}
          disabled={options.colors.length === 0}
        />
        <Select
          label="Season"
          value={season}
          options={SEASONS.map((s) => ({ value: s, label: s }))}
          onChange={(v) => {
            setSeason(v);
            push({ season: v });
          }}
        />
        <Select
          label="Tag"
          value={tag}
          options={options.tags.map((t) => ({ value: t, label: t }))}
          onChange={(v) => {
            setTag(v);
            push({ tag: v });
          }}
          disabled={options.tags.length === 0}
        />
        <label className="relative">
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value as ClosetSortKey;
              setSort(v);
              push({ sort: v });
            }}
            className={`appearance-none rounded-full border px-3 py-1.5 pr-7 text-xs cursor-pointer transition ${
              sort !== "newest"
                ? "bg-ink text-paper border-ink"
                : "bg-white border-ink/10 text-ink hover:border-ink/30"
            }`}
          >
            {CLOSET_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] ${
              sort !== "newest" ? "text-paper" : ""
            }`}
            aria-hidden
          >
            ▾
          </span>
        </label>
        <label
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition ${
            wishlist
              ? "bg-ink text-paper border-ink"
              : "bg-white border-ink/10 text-ink hover:border-ink/30"
          }`}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={wishlist}
            onChange={(e) => {
              setWishlist(e.target.checked);
              push({ wishlist: e.target.checked });
            }}
          />
          Wishlist
        </label>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={reset}
            className="ml-auto text-xs text-ink-muted hover:text-ink underline underline-offset-2"
          >
            Clear ({activeCount})
          </button>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  formatLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  formatLabel?: (label: string) => string;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`appearance-none rounded-full border px-3 py-1.5 pr-7 text-xs cursor-pointer transition ${
          value
            ? "bg-ink text-paper border-ink"
            : "bg-white border-ink/10 text-ink hover:border-ink/30"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {formatLabel ? formatLabel(o.label) : o.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
        aria-hidden
      >
        ▾
      </span>
    </label>
  );
}
