"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Close, Search } from "@/components/icons";
import { springSnappy } from "@/lib/ui-motion";
import { thumbnailUrl } from "@/lib/image-paths";
import { isNoneCategoryStored, NONE_CATEGORY, normalizeCategoryName } from "@/lib/categories";
import {
  listItemsForReassign,
  reassignItemsToCategory,
  type ReassignItem,
} from "@/lib/actions/wardrobeCategories";

type Props = {
  open: boolean;
  categories: string[];
  /** Preselect this as the source, e.g. the category the button sat next to. */
  initialSource?: string | null;
  onClose: () => void;
  /** Fired after a successful move so the caller can refresh. */
  onMoved?: (moved: number, target: string) => void;
};

const ALL = "__all__";

export function CategoryReassignModal({
  open,
  categories,
  initialSource = null,
  onClose,
  onMoved,
}: Props) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<ReassignItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<string>(ALL);
  const [target, setTarget] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload on every open: categories may have changed since last time, and a
  // stale list would offer moves into a category that no longer exists.
  useEffect(() => {
    if (!open) return;
    setItems(null);
    setLoadError(null);
    setSelected(new Set());
    setQuery("");
    setError(null);
    setSource(initialSource ?? ALL);
    setTarget("");
    void listItemsForReassign().then((res) => {
      if (res.ok) setItems(res.items);
      else setLoadError(res.error);
    });
  }, [open, initialSource]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items ?? []) {
      const key = isNoneCategoryStored(it.category) ? NONE_CATEGORY : it.category;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((it) => {
      if (source !== ALL) {
        const key = isNoneCategoryStored(it.category) ? NONE_CATEGORY : it.category;
        if (normalizeCategoryName(key) !== normalizeCategoryName(source)) return false;
      }
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, source, query]);

  // Moving into the category something already sits in is a no-op, so those
  // rows are excluded from the count rather than silently "moved".
  const movable = useMemo(() => {
    if (!target) return [...selected];
    const byId = new Map((items ?? []).map((i) => [i.id, i]));
    return [...selected].filter((id) => {
      const it = byId.get(id);
      if (!it) return false;
      const key = isNoneCategoryStored(it.category) ? NONE_CATEGORY : it.category;
      return normalizeCategoryName(key) !== normalizeCategoryName(target);
    });
  }, [selected, target, items]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of visible) next.add(it.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function move() {
    if (movable.length === 0 || !target) return;
    setError(null);
    setSaving(true);
    void reassignItemsToCategory(movable, target)
      .then((res) => {
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onMoved?.(res.moved, target);
        onClose();
      })
      .catch(() => setError("Could not move those pieces. Please try again."))
      .finally(() => setSaving(false));
  }

  if (!open) return null;

  const targetOptions = [...categories, NONE_CATEGORY];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reassign-title"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSnappy}
        className="bg-paper rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden border border-ink/10"
      >
        <div className="px-5 py-4 border-b border-ink/10 flex items-start justify-between gap-3">
          <div>
            <h2 id="reassign-title" className="font-serif text-xl tracking-tight">
              Reassign pieces
            </h2>
            <p className="text-xs text-ink-muted mt-1 max-w-xl">
              Split one category into two — pick the pieces that belong somewhere else, then choose
              where they go. Everything you don&apos;t select stays put.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-ink shrink-0 p-1"
          >
            <Close size={18} />
          </button>
        </div>

        {/* Source + search */}
        <div className="px-5 py-3 border-b border-ink/10 bg-paper-warm flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">
            From
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="ml-2 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs focus:outline-none focus:border-ink/40"
            >
              <option value={ALL}>All pieces ({items?.length ?? 0})</option>
              {[...categories, NONE_CATEGORY].map((c) => (
                <option key={c} value={c}>
                  {isNoneCategoryStored(c) ? NONE_CATEGORY : c} ({counts.get(c) ?? 0})
                </option>
              ))}
            </select>
          </label>

          <div className="relative flex-1 min-w-[10rem]">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name…"
              className="w-full rounded-lg border border-ink/15 bg-white pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:border-ink/40"
            />
          </div>

          <button
            type="button"
            onClick={selectAllVisible}
            disabled={visible.length === 0}
            className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs hover:bg-paper transition disabled:opacity-40"
          >
            Select all {visible.length > 0 ? `(${visible.length})` : ""}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selected.size === 0}
            className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs hover:bg-paper transition disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {/* Item grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadError ? (
            <p role="alert" className="text-sm text-red-700">
              {loadError}
            </p>
          ) : items === null ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-paper-warm animate-pulse" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing here matches that filter.</p>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {visible.map((it) => {
                const on = selected.has(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => toggle(it.id)}
                      aria-pressed={on}
                      className={`w-full text-left rounded-xl overflow-hidden bg-white ring-2 transition ${
                        on ? "ring-ink" : "ring-transparent hover:ring-ink/20"
                      }`}
                    >
                      <div className="relative aspect-square">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl(it.imagePath)}
                          alt={it.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                        <AnimatePresence>
                          {on && (
                            <motion.span
                              initial={reduce ? false : { scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={reduce ? undefined : { scale: 0.5, opacity: 0 }}
                              transition={springSnappy}
                              className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-ink text-paper flex items-center justify-center"
                            >
                              <Check size={12} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-[11px] truncate">{it.name}</p>
                        <p className="text-[10px] text-ink-muted truncate">
                          {isNoneCategoryStored(it.category) ? NONE_CATEGORY : it.category}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Target + action */}
        <div className="px-5 py-4 border-t border-ink/10 bg-paper-warm space-y-2">
          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-muted">
              Move to
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="ml-2 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs focus:outline-none focus:border-ink/40"
              >
                <option value="">Choose a category…</option>
                {targetOptions.map((c) => (
                  <option key={c} value={c}>
                    {isNoneCategoryStored(c) ? NONE_CATEGORY : c}
                  </option>
                ))}
              </select>
            </label>

            <span className="text-xs text-ink-muted">
              {selected.size === 0
                ? "Nothing selected"
                : target && movable.length !== selected.size
                  ? `${movable.length} of ${selected.size} will move — the rest are already there`
                  : `${selected.size} selected`}
            </span>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm hover:bg-paper transition"
              >
                Cancel
              </button>
              <motion.button
                type="button"
                onClick={move}
                disabled={saving || !target || movable.length === 0}
                whileHover={reduce || saving ? undefined : { scale: 1.03 }}
                whileTap={reduce || saving ? undefined : { scale: 0.97 }}
                transition={springSnappy}
                className="rounded-full bg-ink text-paper px-4 py-2 text-sm hover:bg-ink-soft disabled:opacity-50"
              >
                {saving ? "Moving…" : `Move ${movable.length || ""}`.trim()}
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
