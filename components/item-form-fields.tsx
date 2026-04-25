"use client";

import type { ItemFormValue, Season } from "@/lib/types";
import { CATEGORIES, SEASONS } from "@/lib/types";
import { COMMON_STYLE_TAGS, FAVORITE_COLOR_OPTIONS } from "@/lib/preferences";

type Props = {
  value: ItemFormValue;
  onChange: (patch: Partial<ItemFormValue>) => void;
  disabled?: boolean;
};

export function ItemFormFields({ value, onChange, disabled }: Props) {
  const selectedNames = new Set(value.colors.map((c) => c.name));

  function toggleColor(hex: string, name: string) {
    if (selectedNames.has(name)) {
      onChange({ colors: value.colors.filter((c) => c.name !== name) });
    } else {
      onChange({ colors: [...value.colors, { hex, name }] });
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Name" required>
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          className={inputCls}
          required
        />
      </Field>

      <Field label="Brand">
        <input
          type="text"
          value={value.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          disabled={disabled}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Category">
          <select
            value={value.category}
            onChange={(e) => onChange({ category: e.target.value as ItemFormValue["category"] })}
            disabled={disabled}
            className={inputCls}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subcategory">
          <input
            type="text"
            value={value.subcategory}
            onChange={(e) => onChange({ subcategory: e.target.value })}
            disabled={disabled}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Colors" hint="Tap to toggle">
        <div className="flex flex-wrap gap-2.5">
          {FAVORITE_COLOR_OPTIONS.map((c) => {
            const active = selectedNames.has(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => toggleColor(c.hex, c.name)}
                disabled={disabled}
                aria-pressed={active}
                aria-label={c.name}
                className="flex flex-col items-center gap-1 transition disabled:opacity-50"
              >
                <span
                  className={`block w-9 h-9 rounded-full border transition ${
                    active ? "ring-2 ring-offset-2 ring-accent border-transparent" : "border-ink/10"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-[10px] uppercase tracking-wide text-ink-muted">{c.name}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
        <Field label="Price">
          <div className="flex items-center gap-2">
            <span className="text-ink-muted text-sm">$</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={value.priceCents == null ? "" : Math.round(value.priceCents / 100).toString()}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                if (digits === "") return onChange({ priceCents: null });
                const dollars = parseInt(digits, 10);
                onChange({ priceCents: Number.isFinite(dollars) ? dollars * 100 : null });
              }}
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </Field>
        <Field label="Currency">
          <input
            type="text"
            value={value.currency}
            onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
            disabled={disabled}
            className={`${inputCls} w-20`}
            maxLength={3}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Material">
          <input
            type="text"
            value={value.material}
            onChange={(e) => onChange({ material: e.target.value })}
            disabled={disabled}
            className={inputCls}
          />
        </Field>
        <Field label="Pattern">
          <input
            type="text"
            value={value.pattern}
            onChange={(e) => onChange({ pattern: e.target.value })}
            disabled={disabled}
            className={inputCls}
            placeholder="solid, striped, floral…"
          />
        </Field>
      </div>

      <Field label="Style tags">
        <div className="flex flex-wrap gap-2">
          {[...new Set([...COMMON_STYLE_TAGS, ...value.styleTags])].map((tag) => {
            const checked = value.styleTags.includes(tag);
            return (
              <label
                key={tag}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs capitalize transition ${
                  checked
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...value.styleTags, tag]
                      : value.styleTags.filter((x) => x !== tag);
                    onChange({ styleTags: next });
                  }}
                />
                {tag}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Season">
        <div className="flex flex-wrap gap-2">
          {SEASONS.map((s) => {
            const checked = value.season.includes(s);
            return (
              <label
                key={s}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs capitalize transition ${
                  checked
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={(e) => {
                    const next: Season[] = e.target.checked
                      ? [...value.season, s]
                      : value.season.filter((x) => x !== s);
                    onChange({ season: next });
                  }}
                />
                {s}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          disabled={disabled}
          rows={3}
          className={`${inputCls} resize-none`}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.isWishlist}
          onChange={(e) => onChange({ isWishlist: e.target.checked })}
          disabled={disabled}
          className="accent-ink"
        />
        Wishlist (I don&apos;t own this yet)
      </label>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:bg-paper-warm disabled:text-ink-muted";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wide text-ink-muted mb-1.5">
        {label}
        {required && <span className="text-ink ml-0.5">*</span>}
        {hint && <span className="ml-2 normal-case tracking-normal text-ink-muted/70">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
