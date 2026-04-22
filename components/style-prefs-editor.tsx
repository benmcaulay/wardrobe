"use client";

import type { StylePrefs } from "@/lib/json";
import { FAVORITE_COLOR_OPTIONS, SIZE_SLOTS, STYLE_OPTIONS } from "@/lib/preferences";

type Props = {
  value: StylePrefs;
  onChange: (next: StylePrefs) => void;
  disabled?: boolean;
};

export function StylePrefsEditor({ value, onChange, disabled }: Props) {
  const styles = value.styles ?? [];
  const favoriteColors = value.favoriteColors ?? [];
  const sizes = value.sizes ?? {};

  function toggleStyle(s: string) {
    const next = styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s];
    onChange({ ...value, styles: next });
  }

  function toggleColor(name: string) {
    const next = favoriteColors.includes(name)
      ? favoriteColors.filter((x) => x !== name)
      : [...favoriteColors, name];
    onChange({ ...value, favoriteColors: next });
  }

  function setSize(key: string, v: string) {
    const nextSizes = { ...sizes, [key]: v };
    onChange({ ...value, sizes: nextSizes });
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-3">Styles</h3>
        <div className="flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((s) => {
            const active = styles.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStyle(s)}
                disabled={disabled}
                className={`rounded-full border px-3 py-1 text-xs capitalize transition ${
                  active
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                } disabled:opacity-50`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-3">Favorite colors</h3>
        <div className="flex flex-wrap gap-3">
          {FAVORITE_COLOR_OPTIONS.map((c) => {
            const active = favoriteColors.includes(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => toggleColor(c.name)}
                disabled={disabled}
                aria-pressed={active}
                aria-label={c.name}
                className={`flex flex-col items-center gap-1 transition disabled:opacity-50`}
              >
                <span
                  className={`block w-10 h-10 rounded-full border transition ${
                    active ? "ring-2 ring-offset-2 ring-accent border-transparent" : "border-ink/10"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-[10px] uppercase tracking-wide text-ink-muted">{c.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-3">Sizes</h3>
        <div className="grid grid-cols-3 gap-3">
          {SIZE_SLOTS.map((slot) => (
            <label key={slot.key} className="block">
              <span className="text-xs text-ink-muted">{slot.label}</span>
              <input
                type="text"
                value={sizes[slot.key] ?? ""}
                onChange={(e) => setSize(slot.key, e.target.value)}
                disabled={disabled}
                className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:bg-paper-warm"
                placeholder={slot.key === "shoe" ? "9" : "M"}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
