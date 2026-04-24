"use client";

import type { ItemFormValue, Season } from "@/lib/types";
import { CATEGORIES, SEASONS } from "@/lib/types";
import { COMMON_STYLE_TAGS } from "@/lib/preferences";

type Props = {
  value: ItemFormValue;
  onChange: (patch: Partial<ItemFormValue>) => void;
  disabled?: boolean;
};

export function ItemFormFields({ value, onChange, disabled }: Props) {
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

      <div className="grid grid-cols-2 gap-4">
        <Field label="Brand">
          <input
            type="text"
            value={value.brand}
            onChange={(e) => onChange({ brand: e.target.value })}
            disabled={disabled}
            className={inputCls}
          />
        </Field>
        <Field label="Retailer">
          <input
            type="text"
            value={value.retailer}
            onChange={(e) => onChange({ retailer: e.target.value })}
            disabled={disabled}
            className={inputCls}
          />
        </Field>
      </div>

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

      <Field label="Colors">
        <div className="flex flex-wrap gap-2">
          {value.colors.length === 0 && (
            <span className="text-xs text-ink-muted">No colors detected</span>
          )}
          {value.colors.map((c, i) => (
            <span
              key={`${c.hex}-${i}`}
              className="inline-flex items-center gap-2 rounded-full bg-paper-warm border border-ink/10 px-3 py-1 text-xs"
            >
              <span
                className="w-3 h-3 rounded-full border border-ink/10"
                style={{ backgroundColor: c.hex }}
                aria-hidden
              />
              {c.name}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() =>
                    onChange({ colors: value.colors.filter((_, idx) => idx !== i) })
                  }
                  className="text-ink-muted hover:text-ink"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
        <Field label="Price">
          <div className="flex items-center gap-2">
            <span className="text-ink-muted text-sm">$</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={value.priceCents == null ? "" : (value.priceCents / 100).toFixed(2)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return onChange({ priceCents: null });
                const cents = Math.round(parseFloat(v) * 100);
                onChange({ priceCents: Number.isFinite(cents) ? cents : null });
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

      <Field label="Product URL">
        <input
          type="url"
          value={value.productUrl}
          onChange={(e) => onChange({ productUrl: e.target.value })}
          disabled={disabled}
          className={inputCls}
          placeholder="https://…"
        />
      </Field>

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
