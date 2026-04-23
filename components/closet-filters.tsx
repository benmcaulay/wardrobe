"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORIES, SEASONS } from "@/lib/types";

export type FilterOptions = {
  brands: string[];
  colors: string[];
};

export type ActiveFilters = {
  q: string;
  category: string;
  brand: string;
  color: string;
  season: string;
  wishlist: boolean;
};

type Props = {
  options: FilterOptions;
  initial: ActiveFilters;
};

const DEBOUNCE_MS = 250;

export function ClosetFilters({ options, initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [brand, setBrand] = useState(initial.brand);
  const [color, setColor] = useState(initial.color);
  const [season, setSeason] = useState(initial.season);
  const [wishlist, setWishlist] = useState(initial.wishlist);

  const activeCount =
    (q ? 1 : 0) +
    (category ? 1 : 0) +
    (brand ? 1 : 0) +
    (color ? 1 : 0) +
    (season ? 1 : 0) +
    (wishlist ? 1 : 0);

  function push(next: Partial<ActiveFilters>) {
    const p = new URLSearchParams(searchParams.toString());
    const merged: ActiveFilters = { q, category, brand, color, season, wishlist, ...next };
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
    if (merged.wishlist) p.set("wishlist", "1");
    else p.delete("wishlist");
    const qs = p.toString();
    router.replace(qs ? `/closet?${qs}` : "/closet", { scroll: false });
  }

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
    setWishlist(false);
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
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
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
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
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
            {o.label}
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
