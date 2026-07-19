"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  fieldFromSortKey,
  sortKeyFromField,
  SORT_FIELD_OPTIONS,
  type ClosetSortField,
  type ClosetSortKey,
} from "@/lib/closet-sort";
import { readFiltersFromQueryString } from "@/lib/closet-item-filter";
import { SEASONS } from "@/lib/types";
import { parseMultiFilterParam, serializeMultiFilterParam } from "@/lib/closet-filter-params";

export type CategoryFilterOption = { value: string; label: string };

export type FilterOptions = {
  categories: CategoryFilterOption[];
  brands: string[];
  colors: string[];
  tags: string[];
};

export type ActiveFilters = {
  q: string;
  categories: string[];
  brand: string;
  colors: string[];
  season: string;
  tag: string;
  wishlist: boolean;
  sort: ClosetSortKey;
};

type Props = {
  options: FilterOptions;
  filters: ActiveFilters;
  onFiltersChange: (next: ActiveFilters) => void;
};

const DEBOUNCE_MS = 400;

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

/** Update the address bar without triggering a Next.js navigation (keeps search focus). */
function replaceClosetUrl(qs: string) {
  if (typeof window === "undefined") return;
  const path = qs ? `/closet?${qs}` : "/closet";
  window.history.replaceState(window.history.state, "", path);
}

function buildQueryString(filters: ActiveFilters): string {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  const categoryParam = serializeMultiFilterParam(filters.categories);
  if (categoryParam) p.set("category", categoryParam);
  if (filters.brand) p.set("brand", filters.brand);
  const colorParam = serializeMultiFilterParam(filters.colors);
  if (colorParam) p.set("color", colorParam);
  if (filters.season) p.set("season", filters.season);
  if (filters.tag) p.set("tag", filters.tag);
  if (filters.wishlist) p.set("wishlist", "1");
  if (filters.sort && filters.sort !== "newest") p.set("sort", filters.sort);
  return p.toString();
}

function syncUrl(filters: ActiveFilters) {
  const qs = buildQueryString(filters);
  persistClosetFilters(qs);
  replaceClosetUrl(qs);
}

export function ClosetFilters({ options, filters, onFiltersChange }: Props) {
  const searchParams = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [qDraft, setQDraft] = useState(filters.q);
  const qDraftRef = useRef(filters.q);
  const filtersRef = useRef(filters);
  qDraftRef.current = qDraft;
  filtersRef.current = filters;

  const activeCount =
    (filters.q ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.brand ? 1 : 0) +
    (filters.colors.length > 0 ? 1 : 0) +
    (filters.season ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.wishlist ? 1 : 0) +
    (filters.sort !== "newest" ? 1 : 0);

  function patch(next: Partial<ActiveFilters>) {
    const merged = { ...filters, ...next };
    onFiltersChange(merged);
    syncUrl(merged);
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
      const restored = readFiltersFromQueryString(saved);
      onFiltersChange(restored);
      replaceClosetUrl(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for restore
  }, []);

  // Keep draft in sync when filters change externally (restore, clear all).
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setQDraft(filters.q);
  }, [filters.q]);

  // Debounce URL bar updates for search text (filtering is instant in the parent).
  useEffect(() => {
    const t = setTimeout(() => {
      syncUrl({ ...filtersRef.current, q: qDraftRef.current });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qDraft]);

  function reset() {
    const cleared: ActiveFilters = {
      q: "",
      categories: [],
      brand: "",
      colors: [],
      season: "",
      tag: "",
      wishlist: false,
      sort: "newest",
    };
    setQDraft("");
    onFiltersChange(cleared);
    persistClosetFilters("");
    replaceClosetUrl("");
  }

  return (
    <div className="mb-8 space-y-3">
      <div className="relative">
        <input
          ref={searchRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={qDraft}
          onChange={(e) => {
            const next = e.target.value;
            setQDraft(next);
            onFiltersChange({ ...filters, q: next });
          }}
          placeholder="Search name, brand, category, color, season, tags…"
          aria-label="Search wardrobe"
          className="closet-search-input w-full rounded-full border border-ink/10 bg-white px-5 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
        />
        {qDraft && (
          <button
            type="button"
            onClick={() => {
              setQDraft("");
              patch({ q: "" });
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="Category"
          selected={filters.categories}
          options={options.categories}
          onChange={(categories) => patch({ categories })}
          disabled={options.categories.length === 0}
        />
        <Select
          label="Brand"
          value={filters.brand}
          options={options.brands.map((b) => ({ value: b, label: b }))}
          onChange={(brand) => patch({ brand })}
          disabled={options.brands.length === 0}
        />
        <MultiSelectFilter
          label="Color"
          selected={filters.colors}
          options={options.colors.map((c) => ({ value: c, label: c }))}
          onChange={(colors) => patch({ colors })}
          disabled={options.colors.length === 0}
          formatLabel={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
        />
        <Select
          label="Season"
          value={filters.season}
          options={SEASONS.map((s) => ({ value: s, label: s }))}
          onChange={(season) => patch({ season })}
        />
        <Select
          label="Tag"
          value={filters.tag}
          options={options.tags.map((t) => ({ value: t, label: t }))}
          onChange={(tag) => patch({ tag })}
          disabled={options.tags.length === 0}
        />
        <SortControl sort={filters.sort} onChange={(sort) => patch({ sort })} />
        <label
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition ${
            filters.wishlist
              ? "bg-ink text-paper border-ink"
              : "bg-white border-ink/10 text-ink hover:border-ink/30"
          }`}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={filters.wishlist}
            onChange={(e) => patch({ wishlist: e.target.checked })}
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

function SortControl({
  sort,
  onChange,
}: {
  sort: ClosetSortKey;
  onChange: (v: ClosetSortKey) => void;
}) {
  const { field, reversed } = fieldFromSortKey(sort);
  const active = sort !== "newest";

  function setField(next: ClosetSortField) {
    onChange(sortKeyFromField(next, false));
  }

  function toggleDirection() {
    onChange(sortKeyFromField(field, !reversed));
  }

  return (
    <div
      className={`inline-flex items-stretch rounded-full border text-xs transition overflow-hidden ${
        active ? "bg-ink text-paper border-ink" : "bg-white border-ink/10 text-ink hover:border-ink/30"
      }`}
    >
      <label className="relative flex items-center">
        <span className="sr-only">Sort by</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value as ClosetSortField)}
          className={`appearance-none bg-transparent pl-3 pr-1 py-1.5 cursor-pointer focus:outline-none ${
            active ? "text-paper" : "text-ink"
          }`}
        >
          {SORT_FIELD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={toggleDirection}
        aria-label={reversed ? "Reverse sort direction (currently reversed)" : "Reverse sort direction"}
        title={reversed ? "Sort reversed — click for default order" : "Default order — click to reverse"}
        className={`flex items-center justify-center px-2 border-l transition-colors ${
          active ? "border-paper/20 hover:bg-white/10" : "border-ink/10 hover:bg-paper-warm"
        }`}
      >
        <SortDirectionArrow reversed={reversed} className={active ? "text-paper" : "text-ink-muted"} />
      </button>
    </div>
  );
}

function SortDirectionArrow({ reversed, className }: { reversed: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3 h-3 transition-transform duration-200 ease-out ${className ?? ""} ${
        reversed ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function MultiSelectFilter({
  label,
  selected,
  options,
  onChange,
  disabled,
  formatLabel,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  formatLabel?: (label: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const active = selected.length > 0;
  const summary = active
    ? selected
        .map((v) => {
          const hit = options.find((o) => o.value === v);
          const text = hit?.label ?? v;
          return formatLabel ? formatLabel(text) : text;
        })
        .join(", ")
    : label;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1.5 max-w-[200px] rounded-full border px-3 py-1.5 pr-2 text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${
          active
            ? "bg-ink text-paper border-ink"
            : "bg-white border-ink/10 text-ink hover:border-ink/30"
        }`}
      >
        <span className="truncate">{summary}</span>
        {active && (
          <span className="shrink-0 rounded-full bg-paper/20 px-1.5 text-[10px] tabular-nums">
            {selected.length}
          </span>
        )}
        <span className="text-[10px] shrink-0" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          aria-label={`${label} filter`}
          className="absolute z-30 top-full left-0 mt-1 min-w-[200px] max-w-[min(320px,calc(100vw-3rem))] rounded-xl border border-ink/10 bg-white p-2 shadow-lg"
        >
          <div className="flex flex-wrap gap-1">
            {options.map((o) => {
              const isOn = selected.includes(o.value);
              const text = formatLabel ? formatLabel(o.label) : o.label;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isOn}
                  onClick={() => toggle(o.value)}
                  className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide border transition capitalize ${
                    isOn
                      ? "bg-ink text-paper border-ink"
                      : "bg-paper border-ink/10 text-ink-muted hover:border-ink/25"
                  }`}
                >
                  {text}
                </button>
              );
            })}
          </div>
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 text-[10px] text-ink-muted hover:text-ink underline underline-offset-2"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
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
