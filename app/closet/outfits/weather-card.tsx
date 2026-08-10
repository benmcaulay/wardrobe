"use client";

/**
 * Where you get dressed, and what today's weather is doing there.
 *
 * Sits under the colour rules because that is what it is: another constraint on
 * the outfit. A cold band pushes the scorer toward outerwear the same way a
 * colour rule pushes it toward black, so it belongs with the rules rather than
 * beside the spin dial.
 *
 * The card is explicit about which of three things it is — a real forecast, a
 * historical average, or nothing at all — because the scorer treats a missing
 * band as neutral rather than guessing, and the user should know when their
 * suggestions are weather-blind.
 */

import { useEffect, useState, useTransition } from "react";
import { wornOnFromLocalDate, wornOnToISODate } from "@/lib/wear/rollup";
import { formatTemperature, type TemperatureUnit } from "@/lib/temperature";
import { getDailyContext, setHomeLocation, type DailyContext } from "@/lib/actions/daily-outfit";

const BAND_COPY: Record<string, string> = {
  hot: "Hot",
  warm: "Warm",
  mild: "Mild",
  cool: "Cool",
  cold: "Cold",
};

/**
 * Just the context, not a whole slate.
 *
 * This used to ride along with the daily proposal, so every weather refresh also
 * fit the preference model and built three outfits. With the picks gone there is
 * nothing to build, and it asks for the one thing it renders.
 */
export function useDailyWeather({
  initialContext,
  onChanged,
}: {
  initialContext: DailyContext;
  onChanged: () => void;
}) {
  const [context, setContext] = useState(initialContext);
  const [busy, startTransition] = useTransition();

  // Which calendar day this is, is a question only the user's timezone can
  // answer. A server-dated "today" hands anyone west of UTC tomorrow's forecast
  // all evening.
  const today = wornOnToISODate(wornOnFromLocalDate(new Date()));

  /**
   * Re-pull on mount with the local date. Also what refreshes a forecast cached
   * before the user left the tab open overnight.
   */
  useEffect(() => {
    startTransition(async () => {
      setContext(await getDailyContext(today));
    });
  }, [today]);

  function onRefresh() {
    startTransition(async () => {
      setContext(await getDailyContext(today));
    });
  }

  function onSaveLocation(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await setHomeLocation(trimmed);
      // Re-pull rather than patching the band locally: the forecast is the
      // server's to fetch, and a stale band would keep steering the scorer.
      setContext(await getDailyContext(today));
      onChanged();
    });
  }

  return { context, busy, onRefresh, onSaveLocation };
}

export type DailyWeatherState = ReturnType<typeof useDailyWeather>;

export function WeatherCard({
  weather,
  temperatureUnit,
}: {
  weather: DailyWeatherState;
  temperatureUnit: TemperatureUnit;
}) {
  const { context, busy, onSaveLocation: onSave, onRefresh } = weather;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const known = context.band && context.highC != null;

  if (known && !editing) {
    return (
      <section className="rounded-2xl border border-ink/10 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg">
            {BAND_COPY[context.band!] ?? context.band} · {formatTemperature(context.highC!, temperatureUnit)}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            className="text-[11px] text-ink-muted underline disabled:opacity-50"
          >
            {busy ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {context.location}
          {context.rainChance != null ? ` · ${Math.round(context.rainChance * 100)}% rain` : null}
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {context.source === "forecast"
            ? "Live forecast — factored into every suggestion here."
            : context.source === "manual"
              ? "You set this."
              : "From past records, not a forecast."}{" "}
          <button
            type="button"
            onClick={() => {
              setDraft(context.location ?? "");
              setEditing(true);
            }}
            className="underline hover:text-ink"
          >
            Change
          </button>
        </p>
      </section>
    );
  }

  // No location, or the provider had nothing. Say so plainly rather than
  // dressing the user for a climate nobody measured.
  return (
    <section className="rounded-2xl border border-ink/10 bg-paper-warm p-4">
      <h2 className="font-serif text-lg">Weather</h2>
      <p className="mt-1 text-xs text-ink-muted">
        {editing
          ? "Somewhere else today?"
          : context.source === "unknown"
            ? `Couldn't get today's weather for ${context.location}. Suggestions ignore it for now.`
            : "Tell me where you get dressed and I'll factor in the weather."}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={context.location ?? "San Diego"}
          aria-label="Home location"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onSave(draft);
          }}
          disabled={busy || !draft.trim()}
          className="rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper transition hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-ink-muted underline"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}