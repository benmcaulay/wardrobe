"use client";

import { useState } from "react";
import type { Color } from "@/lib/json";

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
};

export function ReorderableColorList({ items, onReorder, onRemove, removeDisabled }: Props) {
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
            className={`flex items-center gap-2 rounded-xl border bg-white px-2 py-2 transition ${
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
