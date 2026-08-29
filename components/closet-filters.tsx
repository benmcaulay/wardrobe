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
import { SHARED_OWNER_FILTER } from "@/lib/owners";
import { parseMultiFilterParam, serializeMultiFilterParam } from "@/lib/closet-filter-params";
import { isFilterVisible, type ClosetFilterKey } from "@/lib/closet-filter-visibility";
import { setDefaultClosetSort } from "@/lib/actions/preferences";
import {
  searchCategoryOptionRows,
  toggleCategoryOptionRow,
  type CategoryOptionRow,
} from "@/lib/category-tree";

/**
 * A row of the category filter. `depth` and `descendants` are what make it a
 * tree rather than a list: see lib/category-tree.ts.
 */
export type CategoryFilterOption = CategoryOptionRow;

export type OwnerFilterOption = { value: string; label: string };

export type FilterOptions = {
  categories: CategoryFilterOption[];
  brands: string[];
  colors: string[];
  tags: string[];
  /** Owner options (excluding "Everyone"/"Shared", which are built in). */
  owners: OwnerFilterOption[];
};

export type ActiveFilters = {
  q: string;
  categories: string[];
  brand: string;
  colors: string[];
  season: string;
  tag: string;
  owner: string;
  sort: ClosetSortKey;
};

type Props = {
  options: FilterOptions;
  filters: ActiveFilters;
  onFiltersChange: (next: ActiveFilters) => void;
  /** Controls the user has hidden in Settings. Their values are already
   *  neutralised server-side, so we simply don't render them. */
  hiddenFilters?: readonly ClosetFilterKey[];
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
    sp.get("owner") ||
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
  if (filters.owner) p.set("owner", filters.owner);
  if (filters.sort && filters.sort !== "newest") p.set("sort", filters.sort);
  return p.toString();
}

function syncUrl(filters: ActiveFilters) {
  const qs = buildQueryString(filters);
  persistClosetFilters(qs);
  replaceClosetUrl(qs);
}

export function ClosetFilters({
  options,
  filters,
  onFiltersChange,
  hiddenFilters = [],
}: Props) {
  const shows = (key: ClosetFilterKey) => isFilterVisible(key, hiddenFilters);
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
    (filters.owner ? 1 : 0);

  function patch(next: Partial<ActiveFilters>) {
    const merged = { ...filters, ...next };
    onFiltersChange(merged);
    syncUrl(merged);
    // Remember the sort so the closet reopens the same way next time. Only on
    // an actual change, and deliberately not awaited — the grid has already
    // re-sorted locally, so this is bookkeeping.
    if (next.sort !== undefined && next.sort !== filters.sort) {
      void setDefaultClosetSort(next.sort).catch(() => {
        /* a lost preference write isn't worth interrupting the user over */
      });
    }
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
      owner: "",
      // Sort is a saved preference, not a filter — "Clear" leaves it alone.
      sort: filters.sort,
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
          className="closet-search-input w-full rounded-full border border-ink/10 bg-surface px-5 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
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
        {shows("owner") && options.owners.length >= 2 && (
          <OwnerFilter
            options={options.owners}
            value={filters.owner}
            onChange={(owner) => patch({ owner })}
          />
        )}
        {shows("category") && (
          <CategoryTreeFilter
            selected={filters.categories}
            options={options.categories}
            onChange={(categories) => patch({ categories })}
            disabled={options.categories.length === 0}
          />
        )}
        {shows("brand") && (
          <Select
            label="Brand"
            value={filters.brand}
            options={options.brands.map((b) => ({ value: b, label: b }))}
            onChange={(brand) => patch({ brand })}
            disabled={options.brands.length === 0}
          />
        )}
        {shows("color") && (
          <MultiSelectFilter
            label="Color"
            selected={filters.colors}
            options={options.colors.map((c) => ({ value: c, label: c }))}
            onChange={(colors) => patch({ colors })}
            disabled={options.colors.length === 0}
            formatLabel={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
          />
        )}
        {shows("season") && (
          <Select
            label="Season"
            value={filters.season}
            options={SEASONS.map((s) => ({ value: s, label: s }))}
            onChange={(season) => patch({ season })}
          />
        )}
        {shows("tag") && (
          <Select
            label="Tag"
            value={filters.tag}
            options={options.tags.map((t) => ({ value: t, label: t }))}
            onChange={(tag) => patch({ tag })}
            disabled={options.tags.length === 0}
          />
        )}
        {/* Sorting isn't a filter, so it sits behind a divider and its own
            label. Grouped so the rule, the label and the control wrap together
            rather than the divider stranding at the start of a new line. */}
        <div className="ml-1 flex items-center gap-2">
          <span aria-hidden className="h-5 w-px shrink-0 bg-ink/15" />
          <span className="shrink-0 text-xs text-ink-muted">Sort by:</span>
          <SortControl sort={filters.sort} onChange={(sort) => patch({ sort })} />
        </div>

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

/**
 * Owner switcher: a single pill showing who you're looking at, with the roster
 * behind a dropdown. Replaces the old Everyone/Me/Her/Shared segmented row,
 * which grew a segment per owner and dominated the filter bar.
 *
 * Never fills solid black — it always holds a value, so a permanent black pill
 * would read as "filtering" even at the default. A picked owner gets a soft
 * warm fill instead, which still reads as set without shouting.
 */
function OwnerFilter({
  options,
  value,
  onChange,
}: {
  options: OwnerFilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const segments: OwnerFilterOption[] = [
    { value: "", label: "Everyone" },
    ...options,
    { value: SHARED_OWNER_FILTER, label: "Shared" },
  ];
  const active = value !== "";
  const current = segments.find((s) => s.value === value) ?? segments[0];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Owner"
        className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs capitalize transition ${
          active
            ? "border-ink/30 bg-paper-warm text-ink"
            : "border-ink/10 bg-surface text-ink hover:border-ink/30"
        }`}
      >
        <span className="truncate">{current.label}</span>
        <span className="shrink-0 text-[10px]" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Owner filter"
          className="absolute left-0 top-full z-30 mt-1 min-w-[160px] rounded-xl border border-ink/10 bg-surface p-1.5 shadow-lg"
        >
          {segments.map((seg) => {
            const isOn = seg.value === value;
            return (
              <button
                key={seg.value || "__everyone__"}
                type="button"
                role="option"
                aria-selected={isOn}
                onClick={() => {
                  onChange(seg.value);
                  setOpen(false);
                }}
                className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs capitalize transition ${
                  isOn ? "bg-paper-warm text-ink" : "text-ink-muted hover:bg-paper-warm hover:text-ink"
                }`}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
      )}
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
      className={`inline-flex items-stretch overflow-hidden rounded-full border text-xs transition ${
        active
          ? "border-ink/30 bg-paper-warm text-ink"
          : "border-ink/10 bg-surface text-ink hover:border-ink/30"
      }`}
    >
      <label className="relative flex items-center">
        <span className="sr-only">Sort by</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value as ClosetSortField)}
          className="cursor-pointer appearance-none bg-transparent py-1.5 pl-3 pr-1 text-ink focus:outline-none"
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
        className="flex items-center justify-center border-l border-ink/10 px-2 transition-colors hover:bg-paper-warm"
      >
        <SortDirectionArrow reversed={reversed} className="text-ink-muted" />
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

/**
 * The Category filter: a searchable tree.
 *
 * Different enough from `MultiSelectFilter` to be its own control rather than a
 * flag on it. Two reasons, both structural:
 *
 *   - Rows are indented and stacked, not wrapped chips. A wrapped chip cloud
 *     cannot show that "t shirt" is inside "shirt", which is the only reason
 *     the nesting exists.
 *   - Picking a parent picks its subtree, so one click on "shirt" filters to
 *     every kind of shirt. Toggling is therefore over subtrees, not values.
 *
 * The search box appears once the list is long enough to need it — a closet with
 * five categories does not, and an always-present input is one more thing in a
 * popover that is mostly used by pointing.
 */
const CATEGORY_SEARCH_MIN_ROWS = 8;

export function CategoryTreeFilter({
  selected,
  options,
  onChange,
  disabled,
}: {
  selected: string[];
  options: CategoryFilterOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Cleared on close so reopening starts from the whole tree rather than from
  // whatever was typed minutes ago.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const active = selected.length > 0;
  const rows = searchCategoryOptionRows(options, query);
  const showSearch = options.length >= CATEGORY_SEARCH_MIN_ROWS;
  const summary = active
    ? selected
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .map((text) => text.charAt(0).toUpperCase() + text.slice(1))
        .join(", ")
    : "Category";

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
            : "bg-surface border-ink/10 text-ink hover:border-ink/30"
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
          aria-label="Category filter"
          aria-multiselectable
          className="absolute z-30 top-full left-0 mt-1 w-[240px] max-w-[min(320px,calc(100vw-3rem))] rounded-xl border border-ink/10 bg-surface p-2 shadow-lg"
        >
          {showSearch && (
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search categories…"
              aria-label="Search categories"
              className="mb-2 w-full rounded-lg border border-ink/10 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          )}
          <div className="max-h-[280px] overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-ink-muted">No category matches that.</p>
            ) : (
              rows.map((row) => {
                const isOn = selected.includes(row.value);
                return (
                  <button
                    key={row.value}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    onClick={() => onChange(toggleCategoryOptionRow(selected, row))}
                    style={{ paddingLeft: 6 + Math.min(row.depth, 4) * 14 }}
                    className={`flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs capitalize transition ${
                      isOn ? "bg-ink text-paper" : "text-ink hover:bg-paper-warm"
                    }`}
                    title={
                      row.descendants.length > 0
                        ? `Includes ${row.descendants.length} nested ${
                            row.descendants.length === 1 ? "category" : "categories"
                          }`
                        : undefined
                    }
                  >
                    {/* Nesting cue for the indented rows, so depth is readable
                        even when a parent is filtered out by a search. */}
                    {row.depth > 0 && (
                      <span aria-hidden className="text-[9px] opacity-50">
                        ↳
                      </span>
                    )}
                    <span className="truncate">{row.label}</span>
                    {row.descendants.length > 0 && (
                      <span
                        className={`ml-auto shrink-0 text-[9px] tabular-nums ${
                          isOn ? "text-paper/70" : "text-ink-muted"
                        }`}
                      >
                        +{row.descendants.length}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 text-[10px] text-ink-muted hover:text-ink underline underline-offset-2"
            >
              Clear category
            </button>
          )}
        </div>
      )}
    </div>
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
            : "bg-surface border-ink/10 text-ink hover:border-ink/30"
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
          className="absolute z-30 top-full left-0 mt-1 min-w-[200px] max-w-[min(320px,calc(100vw-3rem))] rounded-xl border border-ink/10 bg-surface p-2 shadow-lg"
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

/**
 * Single-choice filter pill.
 *
 * Built as a popover rather than a native <select> because a <select> sizes
 * itself to its widest *option* — the Brand control was as wide as
 * "Legendary Headwear" while showing the word "Brand". A custom trigger renders
 * only the current label, so every pill shrinks to fit its own text.
 */
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = !!value;
  const current = options.find((o) => o.value === value);
  const text = active ? formatLabel?.(current?.label ?? value) ?? current?.label ?? value : label;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? "bg-ink text-paper border-ink"
            : "bg-surface border-ink/10 text-ink hover:border-ink/30"
        }`}
      >
        <span className="truncate">{text}</span>
        <span className="shrink-0 text-[10px]" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          aria-label={`${label} filter`}
          className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-[180px] max-w-[min(320px,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-ink/10 bg-surface p-2 shadow-lg"
        >
          <div className="flex flex-wrap gap-1">
            {options.map((o) => {
              const isOn = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isOn}
                  onClick={() => choose(isOn ? "" : o.value)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide capitalize transition ${
                    isOn
                      ? "bg-ink text-paper border-ink"
                      : "bg-paper border-ink/10 text-ink-muted hover:border-ink/25"
                  }`}
                >
                  {formatLabel ? formatLabel(o.label) : o.label}
                </button>
              );
            })}
          </div>
          {active && (
            <button
              type="button"
              onClick={() => choose("")}
              className="mt-2 text-[10px] text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
