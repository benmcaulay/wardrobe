"use client";

/**
 * The wardrobe category list, as a tree you rearrange by dragging.
 *
 * Two drop zones per row, split down the middle, because nesting and reordering
 * are the same gesture with different intent and a modifier key is not
 * discoverable:
 *
 *   left half  → same level as that row, immediately above it (the old reorder)
 *   right half → inside that row, as its last child
 *
 * The trailing strip below the list is the one position halves cannot express:
 * last at the top level. Without it, a category dragged to the bottom could only
 * ever land *above* the final row.
 *
 * Replaces the "Reassign pieces…" panel, which existed for the same problem
 * from the other end: adding "t shirt" next to "shirt" left every piece behind,
 * so the fix was to hand-move them. Nesting means there is nothing to move —
 * "t shirt" lives under "shirt" and a filter on the parent still finds it.
 */

import { useState } from "react";
import {
  buildCategoryTree,
  flattenCategoryTree,
  type CategoryDropMode,
  type CategoryParents,
} from "@/lib/category-tree";

/** Pixels of indent per level. */
const INDENT_PX = 22;

/** Deepest indent drawn. Deeper rows still nest, they just stop marching right. */
const MAX_INDENT_DEPTH = 6;

type Props = {
  list: string[];
  parents: CategoryParents;
  onMove: (dragged: string, target: string, mode: CategoryDropMode) => void;
  onRename?: (oldName: string, newName: string) => void;
  onRemove?: (name: string) => void;
};

type DropTarget = { key: string; mode: CategoryDropMode } | null;

export function CategoryTreeEditor({ list, parents, onMove, onRename, onRemove }: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const rows = flattenCategoryTree(buildCategoryTree(list, parents));
  const lastRoot = [...rows].reverse().find((r) => r.depth === 0) ?? null;

  function endDrag() {
    setDragKey(null);
    setDropTarget(null);
  }

  function startRename(key: string, name: string) {
    if (!onRename) return;
    setEditingKey(key);
    setDraft(name);
  }

  function commitRename(name: string) {
    const next = draft.trim();
    setEditingKey(null);
    setDraft("");
    if (!next || next === name) return;
    onRename?.(name, next);
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => {
          const isDragging = dragKey === row.key;
          const isEditing = editingKey === row.key;
          const over = dropTarget?.key === row.key && dragKey !== null && dragKey !== row.key;
          const nesting = over && dropTarget?.mode === "child";
          const beside = over && dropTarget?.mode === "sibling";
          return (
            <li
              key={row.key}
              style={{ marginLeft: Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT_PX }}
              onDragOver={(e) => {
                if (!dragKey || dragKey === row.key) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                // Which half of the row the pointer is over. This is the whole
                // interaction, so it reads off the live box rather than a
                // remembered one — the rows shift as the list re-renders.
                const rightHalf = e.clientX - box.left > box.width / 2;
                setDropTarget({ key: row.key, mode: rightHalf ? "child" : "sibling" });
              }}
              onDragLeave={() => {
                if (dropTarget?.key === row.key) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = dragKey;
                const mode = dropTarget?.mode;
                endDrag();
                if (!dragged || !mode || dragged === row.key) return;
                onMove(dragged, row.name, mode);
              }}
              className={`relative flex items-center gap-2 rounded-xl border bg-white px-2 py-2 transition ${
                nesting ? "border-ink ring-1 ring-ink/20" : "border-ink/10"
              } ${beside ? "border-t-2 border-t-ink" : ""} ${isDragging ? "opacity-40" : ""}`}
            >
              <button
                type="button"
                draggable={!isEditing}
                onDragStart={(e) => {
                  setDragKey(row.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", row.name);
                }}
                onDragEnd={endDrag}
                className="flex-shrink-0 w-8 h-8 rounded-lg text-ink-muted hover:bg-paper-warm hover:text-ink cursor-grab active:cursor-grabbing touch-none disabled:opacity-40"
                aria-label={`Drag to move ${row.name}`}
                disabled={isEditing}
              >
                <span className="block text-center text-sm leading-none select-none" aria-hidden>
                  ⋮⋮
                </span>
              </button>
              {isEditing ? (
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(row.name);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingKey(null);
                      setDraft("");
                    }
                  }}
                  onBlur={() => commitRename(row.name)}
                  className="flex-1 min-w-0 rounded-lg border border-ink/15 px-2 py-1 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-accent/40"
                  aria-label={`Rename ${row.name}`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startRename(row.key, row.name)}
                  disabled={!onRename}
                  className={`text-sm flex-1 min-w-0 truncate text-left capitalize ${
                    onRename ? "hover:text-ink cursor-text" : ""
                  }`}
                  title={onRename ? "Click to rename" : undefined}
                >
                  {row.name}
                </button>
              )}
              {/*
                Says what the drop will do, in place, while the pointer is
                still over the row. A highlight alone cannot distinguish
                "above this" from "inside this".
              */}
              {nesting && (
                <span className="pointer-events-none absolute right-10 rounded-full bg-ink px-2 py-0.5 text-[10px] tracking-wide text-paper">
                  inside {row.name}
                </span>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(row.name)}
                  disabled={isEditing}
                  className="flex-shrink-0 w-7 h-7 rounded-full border border-red-200 text-red-700 text-xs hover:bg-red-50 disabled:opacity-40"
                  aria-label={`Remove ${row.name}`}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Only useful mid-drag, and only when there is a root row to land after. */}
      {dragKey && lastRoot && lastRoot.key !== dragKey && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropTarget({ key: lastRoot.key, mode: "after" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = dragKey;
            endDrag();
            if (dragged) onMove(dragged, lastRoot.name, "after");
          }}
          className={`rounded-xl border border-dashed px-3 py-2 text-center text-xs transition ${
            dropTarget?.mode === "after"
              ? "border-ink bg-paper-warm text-ink"
              : "border-ink/20 text-ink-muted"
          }`}
        >
          Drop here to move out of any category, at the end
        </div>
      )}
    </div>
  );
}
