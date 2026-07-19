"use client";

import { useMemo } from "react";
import type { ItemFormValue, Season } from "@/lib/types";
import { CATEGORIES, SEASONS } from "@/lib/types";
import { NONE_CATEGORY, normalizeCategoryName } from "@/lib/categories";
import { COMMON_STYLE_TAGS, FAVORITE_COLOR_OPTIONS, normalizeStyleTagName } from "@/lib/preferences";

type Props = {
  value: ItemFormValue;
  onChange: (patch: Partial<ItemFormValue>) => void;
  disabled?: boolean;
  categories?: string[];
  /** Ordered style-tag chips (from Settings); defaults to built-ins when omitted. */
  styleTags?: string[];
  /** Ordered color palette (from Settings); defaults to built-ins when omitted. */
  colorOptions?: readonly { hex: string; name: string }[];
};

export function ItemFormFields({
  value,
  onChange,
  disabled,
  categories = CATEGORIES,
  styleTags = [...COMMON_STYLE_TAGS],
  colorOptions = FAVORITE_COLOR_OPTIONS,
}: Props) {
  const selectedNames = new Set(value.colors.map((c) => c.name));

  const categoryOptions = useMemo(() => {
    const source = categories.length > 0 ? categories : CATEGORIES;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of source) {
      const key = normalizeCategoryName(c);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c.trim());
    }
    const raw = value.category?.trim() ?? "";
    if (raw) {
      const key = normalizeCategoryName(raw);
      if (key && !seen.has(key)) {
        out.unshift(raw);
        seen.add(key);
      }
    }
    return out;
  }, [categories, value.category]);

  /** Must match an <option value> exactly or the browser resets the select. */
  const selectCategoryValue = useMemo(() => {
    const raw = value.category?.trim() ?? "";
    if (!raw || normalizeCategoryName(raw) === normalizeCategoryName(NONE_CATEGORY)) {
      return NONE_CATEGORY;
    }
    const key = normalizeCategoryName(raw);
    const match = categoryOptions.find((o) => normalizeCategoryName(o) === key);
    return match ?? raw;
  }, [categoryOptions, value.category]);

  const tagChips = useMemo(() => {
    const base = styleTags.length > 0 ? styleTags : [...COMMON_STYLE_TAGS];
    const keys = new Set(base.map((t) => normalizeStyleTagName(t)));
    const extras = value.styleTags.filter((t) => !keys.has(normalizeStyleTagName(t)));
    return [...base, ...extras];
  }, [styleTags, value.styleTags]);

  function toggleColor(hex: string, name: string) {
    if (selectedNames.has(name)) {
      onChange({ colors: value.colors.filter((c) => c.name !== name) });
    } else {
      onChange({ colors: [...value.colors, { hex, name }] });
    }
  }

  // The first color drives color sorting, so "primary" == index 0.
  const primaryName = value.colors[0]?.name ?? null;

  function setPrimaryColor(name: string) {
    const idx = value.colors.findIndex((c) => c.name === name);
    if (idx <= 0) return; // already primary or not selected
    const next = [...value.colors];
    const [picked] = next.splice(idx, 1);
    next.unshift(picked);
    onChange({ colors: next });
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
            value={selectCategoryValue}
            onChange={(e) => {
              const picked = e.target.value;
              if (picked === NONE_CATEGORY) {
                if (value.category !== NONE_CATEGORY) onChange({ category: NONE_CATEGORY });
                return;
              }
              const key = normalizeCategoryName(picked);
              const canonical =
                categoryOptions.find((o) => normalizeCategoryName(o) === key) ?? picked;
              if (canonical !== value.category) onChange({ category: canonical });
            }}
            disabled={disabled}
            className={inputCls}
          >
            <option value={NONE_CATEGORY}>{NONE_CATEGORY}</option>
            {categoryOptions.map((c) => (
              <option key={normalizeCategoryName(c)} value={c}>
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

      <Field label="Colors" hint="Tap to toggle · star = sort color">
        <div className="flex flex-wrap gap-2.5">
          {colorOptions.map((c) => {
            const active = selectedNames.has(c.name);
            const isPrimary = active && primaryName === c.name;
            return (
              <div key={c.name} className="group flex flex-col items-center gap-1">
                <button
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
                {/* Reserve a fixed slot so hovering doesn't shift the row. */}
                <div className="h-4 flex items-center justify-center">
                  {active && (
                    <button
                      type="button"
                      onClick={() => setPrimaryColor(c.name)}
                      disabled={disabled || isPrimary}
                      aria-label={
                        isPrimary ? `${c.name} is the primary sort color` : `Make ${c.name} the primary sort color`
                      }
                      aria-pressed={isPrimary}
                      title={isPrimary ? "Primary sort color" : "Make primary sort color"}
                      className={`transition disabled:cursor-default ${
                        isPrimary
                          ? "text-accent opacity-100"
                          : "text-ink-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent"
                      }`}
                    >
                      <StarIcon filled={isPrimary} />
                    </button>
                  )}
                </div>
              </div>
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
          {tagChips.map((tag) => {
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

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.75l2.85 5.77 6.37.93-4.61 4.49 1.09 6.34L12 17.77l-5.7 3l1.09-6.34L2.78 9.95l6.37-.93L12 2.75z" />
    </svg>
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
