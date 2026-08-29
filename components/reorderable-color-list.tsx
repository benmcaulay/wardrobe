"use client";

import { useState } from "react";
import type { Color } from "@/lib/json";
import { isFavoriteColor } from "@/lib/colors";

function reorderList<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  const next = [...list];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
}

type Props = {
  items: Color[];
  onReorder: (next: Color[]) => void;
  onRemove?: (color: Color) => void;
  removeDisabled?: (color: Color) => boolean;
  /** Normalised names of the favourited colours. Omit to hide the hearts. */
  favorites?: readonly string[];
  onToggleFavorite?: (color: Color, favorite: boolean) => void;
};

export function ReorderableColorList({
  items,
  onReorder,
  onRemove,
  removeDisabled,
  favorites,
  onToggleFavorite,
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function endDrag() {
    setDragFrom(null);
    setDragOver(null);
  }

  function handleDrop(targetIdx: number) {
    if (dragFrom === null) return;
    const next = reorderList(items, dragFrom, targetIdx);
    endDrag();
    onReorder(next);
  }

  return (
    <ul className="space-y-2">
      {items.map((color, idx) => {
        const isDragging = dragFrom === idx;
        const isOver = dragOver === idx && dragFrom !== null && dragFrom !== idx;
        return (
          <li
            key={color.name}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(idx);
            }}
            onDragLeave={() => {
              if (dragOver === idx) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(idx);
            }}
            className={`flex items-center gap-2 rounded-xl border bg-surface px-2 py-2 transition ${
              isOver ? "border-ink ring-1 ring-ink/20" : "border-ink/10"
            } ${isDragging ? "opacity-40" : ""}`}
          >
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                setDragFrom(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragEnd={endDrag}
              className="flex-shrink-0 w-8 h-8 rounded-lg text-ink-muted hover:bg-paper-warm hover:text-ink cursor-grab active:cursor-grabbing touch-none"
              aria-label={`Drag to reorder ${color.name}`}
            >
              <span className="block text-center text-sm leading-none select-none" aria-hidden>
                ⋮⋮
              </span>
            </button>
            <span
              className="flex-shrink-0 w-6 h-6 rounded-full border border-ink/10"
              style={{ backgroundColor: color.hex }}
              aria-hidden
            />
            <span className="text-sm flex-1 min-w-0 truncate capitalize">{color.name}</span>
            <span className="text-[11px] text-ink-muted/70 tabular-nums select-none">
              {color.hex}
            </span>
            {favorites && onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(color, !isFavoriteColor(favorites, color.name))}
                aria-pressed={isFavoriteColor(favorites, color.name)}
                aria-label={
                  isFavoriteColor(favorites, color.name)
                    ? `Remove ${color.name} from favorites`
                    : `Add ${color.name} to favorites`
                }
                title={
                  isFavoriteColor(favorites, color.name)
                    ? "A favorite — click to unfavorite"
                    : "Mark as a favorite"
                }
                className={`flex-shrink-0 grid place-items-center w-7 h-7 rounded-full transition ${
                  isFavoriteColor(favorites, color.name)
                    ? "text-accent hover:bg-accent/10"
                    : "text-ink-muted/40 hover:text-ink-muted hover:bg-paper-warm"
                }`}
              >
                {/* Filled when it's a favourite, outlined when it isn't — the
                    same shape either way, so the row doesn't shift. */}
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill={isFavoriteColor(favorites, color.name) ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 20.2s-7.5-4.3-7.5-9.2a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 4.9-7.5 9.2-7.5 9.2z" />
                </svg>
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(color)}
                disabled={removeDisabled?.(color)}
                className="flex-shrink-0 w-7 h-7 rounded-full border border-red-200 text-red-700 text-xs hover:bg-red-50 disabled:opacity-40"
                aria-label={`Remove ${color.name}`}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
