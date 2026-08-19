"use client";

/**
 * Destination combobox.
 *
 * The trip's destination used to be a free-text box whose contents were
 * re-geocoded on every climate refresh. That made "where am I going" a guess
 * the app re-took behind your back, and there was nowhere to see or correct
 * it. Here the choice is made once, explicitly, against real candidates — and
 * what comes back carries coordinates, so the map and the forecast agree.
 *
 * Typing without choosing is still allowed: the caller gets the raw text and
 * saves an unpinned destination. Worse than a pin, but a picker that refuses
 * to accept "Grandma's house" is worse still.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flagEmoji, placeContext, type Place } from "@/lib/places";

/**
 * How long to sit on a keystroke before searching. Long enough that typing
 * "Seoul" is one request rather than four, short enough to feel immediate.
 */
const DEBOUNCE_MS = 250;

export function CityPicker({
  value,
  onChange,
  onPick,
  search,
  placeholder = "Search for a city…",
  autoFocus,
  className,
}: {
  value: string;
  /** Free text, for the case where nothing is picked from the list. */
  onChange: (text: string) => void;
  onPick: (place: Place) => void;
  /** Injected so this component never imports the provider or a server action. */
  search: (query: string) => Promise<Place[]>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  /** The text the last search was fired for, so re-opening doesn't re-search. */
  const [searched, setSearched] = useState<string | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  /**
   * Guards against a slow early request landing after a fast later one and
   * repopulating the list with results for a prefix the user has moved past.
   */
  const requestSeq = useRef(0);

  const runSearch = useCallback(
    async (query: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      const places = await search(query);
      if (seq !== requestSeq.current) return;
      setResults(places);
      setActive(0);
      setLoading(false);
      setSearched(query);
    },
    [search],
  );

  // Debounced search on the current text. Skipped while the box is closed, so
  // picking a result (which closes it) doesn't immediately search for the
  // label we just filled in.
  useEffect(() => {
    if (!open) return;
    const query = value.trim();
    if (query.length < 2) {
      setResults([]);
      setSearched(null);
      return;
    }
    if (query === searched) return;
    const timer = window.setTimeout(() => void runSearch(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `searched` is deliberately out of the dependency list: including it
    // re-runs this the moment a search completes, which reschedules the timer
    // forever. It's read here only as a "have we already asked this?" guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open, runSearch]);

  // Close when focus or a click leaves the combobox entirely.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  function choose(place: Place) {
    onPick(place);
    setOpen(false);
    setResults([]);
    // Remember what we searched for so reopening on the filled-in label
    // doesn't fire a fresh lookup for it.
    setSearched(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
      return;
    }
    if (event.key === "Enter" && open && results[active]) {
      event.preventDefault();
      choose(results[active]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const showList = open && value.trim().length >= 2;
  const empty = showList && !loading && results.length === 0 && searched === value.trim();

  return (
    <div ref={wrapper} className={`relative ${className ?? ""}`}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && results[active] ? `${listId}-${results[active].id}` : undefined
        }
        className="w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-ink/15 bg-paper py-1 shadow-tile"
        >
          {results.map((place, index) => (
            <li key={place.id} id={`${listId}-${place.id}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                // mousedown, not click: the input's blur would otherwise close
                // the list before the click ever lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(place);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition ${
                  index === active ? "bg-paper-warm" : ""
                }`}
              >
                <span aria-hidden className="text-sm leading-none">
                  {flagEmoji(place.countryCode)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{place.name}</span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {placeContext(place)}
                  </span>
                </span>
                {place.population != null && place.population > 0 ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
                    {compactPopulation(place.population)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {loading && results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-muted">Searching…</li>
          ) : null}
          {empty ? (
            <li className="px-3 py-2 text-xs text-ink-muted">
              No match. You can still type it in — we&apos;ll just ask you for the weather.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** "9.8M", "518k" — a size hint that helps you spot the city you meant. */
function compactPopulation(population: number): string {
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M`;
  if (population >= 1_000) return `${Math.round(population / 1_000)}k`;
  return String(population);
}
