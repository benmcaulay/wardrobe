"use client";

/**
 * The gear library.
 *
 * Mirrors the bags page: a list you own, an inline form, and no wizardry. The
 * one thing it does differently is offer the preset list up front, because an
 * empty library with an "Add" button is a chore nobody completes, and a library
 * nobody fills means every bag meter on the trip page stays wrong.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GearIcon, ICON_NAMES } from "@/components/gear-icon";
import { formatVolume, formatWeight } from "@/lib/packing/estimate";
import {
  GEAR_CATEGORIES,
  GEAR_PRESETS,
  gearFootprint,
  gearIconName,
  type GearCategory,
} from "@/lib/packing/gear";
import { addGearPresets, createGear, deleteGear, updateGear } from "../actions";

export type GearView = {
  id: string;
  name: string;
  category: GearCategory;
  icon: string | null;
  quantity: number;
  weightGrams: number | null;
  volumeLiters: number | null;
  notes: string | null;
  essential: boolean;
};

type Draft = {
  name: string;
  category: GearCategory;
  icon: string;
  quantity: string;
  weightGrams: string;
  volumeLiters: string;
  notes: string;
  essential: boolean;
};

const BLANK: Draft = {
  name: "",
  category: "misc",
  icon: "",
  quantity: "1",
  weightGrams: "",
  volumeLiters: "",
  notes: "",
  essential: false,
};

function toDraft(gear: GearView): Draft {
  return {
    name: gear.name,
    category: gear.category,
    icon: gear.icon ?? "",
    quantity: String(gear.quantity),
    weightGrams: gear.weightGrams == null ? "" : String(gear.weightGrams),
    volumeLiters: gear.volumeLiters == null ? "" : String(gear.volumeLiters),
    notes: gear.notes ?? "",
    essential: gear.essential,
  };
}

export function GearClient({ initial }: { initial: GearView[] }) {
  const router = useRouter();
  const [gear, setGear] = useState(initial);

  // `router.refresh()` re-runs the server component and hands down a new
  // `initial`; without this the list would keep rendering the snapshot taken
  // when the component first mounted.
  useEffect(() => setGear(initial), [initial]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => {
    let weightGrams = 0;
    let volumeLiters = 0;
    for (const row of gear) {
      const footprint = gearFootprint(row);
      weightGrams += footprint.weightGrams;
      volumeLiters += footprint.volumeLiters;
    }
    return { weightGrams, volumeLiters: Math.round(volumeLiters * 10) / 10 };
  }, [gear]);

  const missing = useMemo(() => {
    const have = new Set(gear.map((g) => g.name.toLowerCase()));
    return GEAR_PRESETS.filter((p) => !have.has(p.name.toLowerCase()));
  }, [gear]);

  async function save(draft: Draft, id: string | null) {
    setBusy(true);
    setError(null);
    const payload = {
      name: draft.name,
      category: draft.category,
      icon: draft.icon || null,
      quantity: Number(draft.quantity) || 1,
      weightGrams: draft.weightGrams === "" ? null : Number(draft.weightGrams),
      volumeLiters: draft.volumeLiters === "" ? null : Number(draft.volumeLiters),
      notes: draft.notes || null,
      essential: draft.essential,
    };
    const res = id ? await updateGear({ id, ...payload }) : await createGear(payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditingId(null);
    setAdding(false);
    // The server normalises names, rounds sizes and assigns ids, so re-read
    // rather than guessing what it stored.
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteGear(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setGear((prev) => prev.filter((g) => g.id !== id));
  }

  async function addPresets(names: string[]) {
    setBusy(true);
    setError(null);
    const res = await addGearPresets(names);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  const groups = GEAR_CATEGORIES.map((category) => ({
    ...category,
    rows: gear.filter((g) => g.category === category.id),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {/* Presets. Shown while anything is still missing, because the list is
          also the fastest way to add a second or third item later. */}
      {missing.length > 0 ? (
        <section className="rounded-2xl border border-ink/10 bg-paper-warm/50 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-lg">
              {gear.length === 0 ? "Start from the usual suspects" : "Add something common"}
            </h2>
            {gear.length === 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void addPresets(GEAR_PRESETS.filter((p) => p.essential).map((p) => p.name))}
                className="rounded-full bg-ink px-4 py-1.5 text-xs text-paper transition hover:bg-ink-soft disabled:opacity-50"
              >
                Add the essentials
              </button>
            ) : null}
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {missing.map((preset) => (
              <li key={preset.name}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void addPresets([preset.name])}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-surface px-3 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
                >
                  <GearIcon
                    name={preset.icon ?? "pouch"}
                    className="h-3.5 w-3.5 text-ink-muted"
                  />
                  {preset.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {gear.length === 0
            ? "Nothing here yet."
            : `${gear.length} ${gear.length === 1 ? "thing" : "things"} · ${formatWeight(
                totals.weightGrams,
              )} · ${formatVolume(totals.volumeLiters)} if you packed all of it`}
        </p>
        <button
          type="button"
          onClick={() => {
            setAdding((o) => !o);
            setEditingId(null);
          }}
          className="rounded-full border border-ink/25 px-4 py-2 text-xs transition hover:bg-paper-warm"
        >
          {adding ? "Cancel" : "+ Add gear"}
        </button>
      </div>

      {adding ? (
        <GearForm initial={BLANK} busy={busy} onCancel={() => setAdding(false)} onSave={(d) => void save(d, null)} />
      ) : null}

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.id}>
            <h2 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
              <GearIcon name={group.icon} className="h-3.5 w-3.5" />
              {group.label}
            </h2>
            <ul className="mt-2 space-y-2">
              {group.rows.map((row) =>
                editingId === row.id ? (
                  <li key={row.id}>
                    <GearForm
                      initial={toDraft(row)}
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSave={(d) => void save(d, row.id)}
                    />
                  </li>
                ) : (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-xl border border-ink/10 bg-surface p-3 shadow-tile"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-warm">
                      <GearIcon name={gearIconName(row)} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="truncate text-sm">{row.name}</span>
                        {row.quantity > 1 ? (
                          <span className="text-[11px] text-ink-muted">×{row.quantity}</span>
                        ) : null}
                        {row.essential ? (
                          <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] text-ink">
                            always
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {(() => {
                          const f = gearFootprint(row);
                          return `${formatWeight(f.weightGrams)} · ${formatVolume(f.volumeLiters)}${
                            f.estimated ? " (estimated)" : ""
                          }`;
                        })()}
                        {row.notes ? ` · ${row.notes}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setAdding(false);
                      }}
                      className="shrink-0 text-[11px] text-ink-muted underline hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(row.id)}
                      className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-[11px] text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>

      {gear.length > 0 ? (
        <p className="text-xs text-ink-muted">
          Pack these into bags from any{" "}
          <Link href="/closet/smartpakker" className="underline hover:text-ink">
            trip
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * Add or edit one piece of gear.
 *
 * Weight and volume are optional on purpose. Requiring them would mean either
 * lying (typing a number you don't know) or not recording the item at all, and
 * an item recorded with an estimated size is far more useful to a bag meter
 * than an item that isn't there.
 */
function GearForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="rounded-2xl border border-ink/15 bg-surface p-5 shadow-tile">
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Name</label>
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            autoFocus
            placeholder="Travel plug adapter"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Kind</label>
          <select
            value={draft.category}
            onChange={(e) => set("category", e.target.value as GearCategory)}
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          >
            {GEAR_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Qty</label>
          <input
            value={draft.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
            Grams <span className="normal-case tracking-normal">(each, optional)</span>
          </label>
          <input
            value={draft.weightGrams}
            onChange={(e) => set("weightGrams", e.target.value)}
            inputMode="numeric"
            placeholder="we'll estimate"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
            Litres <span className="normal-case tracking-normal">(each, optional)</span>
          </label>
          <input
            value={draft.volumeLiters}
            onChange={(e) => set("volumeLiters", e.target.value)}
            inputMode="decimal"
            placeholder="we'll estimate"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Icon</label>
          <select
            value={draft.icon}
            onChange={(e) => set("icon", e.target.value)}
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          >
            <option value="">Match the kind</option>
            {ICON_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
            Note <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Type-C, works in Korea and Japan"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-xs text-ink-muted sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.essential}
            onChange={(e) => set("essential", e.target.checked)}
            className="h-4 w-4 rounded border-ink/30"
          />
          I take this every trip
        </label>
      </div>

      {/* A live preview of the icon, so picking one isn't guessing from a name. */}
      <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
        <GearIcon
          name={draft.icon || GEAR_CATEGORIES.find((c) => c.id === draft.category)?.icon || "pouch"}
          className="h-5 w-5 text-ink"
        />
        <span>{draft.icon ? "Chosen icon" : "Icon for this kind"}</span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={busy || !draft.name.trim()}
          className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
