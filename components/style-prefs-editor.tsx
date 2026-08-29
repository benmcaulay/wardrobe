"use client";

import type { StylePrefs } from "@/lib/json";
import { SIZE_SLOTS, STYLE_OPTIONS } from "@/lib/preferences";

type Props = {
  value: StylePrefs;
  onChange: (next: StylePrefs) => void;
  disabled?: boolean;
};

export function StylePrefsEditor({ value, onChange, disabled }: Props) {
  const styles = value.styles ?? [];
  const sizes = value.sizes ?? {};

  function toggleStyle(s: string) {
    const next = styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s];
    onChange({ ...value, styles: next });
  }

  function setSize(key: string, v: string) {
    const nextSizes = { ...sizes, [key]: v };
    onChange({ ...value, sizes: nextSizes });
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-3">Styles</h3>
        {/* One row, scrolled — these labels are words, so shrinking them to fit
            would truncate. Matches the thumbnail-strip idiom elsewhere. */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STYLE_OPTIONS.map((s) => {
            const active = styles.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStyle(s)}
                disabled={disabled}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs capitalize transition ${
                  active
                    ? "bg-ink text-paper border-ink"
                    : "bg-surface border-ink/10 text-ink hover:border-ink/30"
                } disabled:opacity-50`}
              >
                {s}
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
                className="mt-1 w-full rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:bg-paper-warm"
                placeholder={slot.key === "shoe" ? "9" : "M"}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
