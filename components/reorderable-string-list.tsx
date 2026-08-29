"use client";

import { useState } from "react";

function reorderList<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  const next = [...list];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
}

type Props = {
  items: string[];
  onReorder: (next: string[]) => void;
  onRemove?: (name: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  removeDisabled?: (name: string) => boolean;
  formatLabel?: (name: string) => string;
  labelClassName?: string;
};

export function ReorderableStringList({
  items,
  onReorder,
  onRemove,
  onRename,
  removeDisabled,
  formatLabel = (n) => n,
  labelClassName = "",
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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

  function startRename(name: string) {
    if (!onRename) return;
    setEditingName(name);
    setDraft(name);
  }

  function cancelRename() {
    setEditingName(null);
    setDraft("");
  }

  function commitRename(oldName: string) {
    const next = draft.trim();
    cancelRename();
    if (!next || next === oldName) return;
    onRename?.(oldName, next);
  }

  return (
    <ul className="space-y-2">
      {items.map((name, idx) => {
        const isDragging = dragFrom === idx;
        const isOver = dragOver === idx && dragFrom !== null && dragFrom !== idx;
        const isEditing = editingName === name;
        return (
          <li
            key={name}
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
              draggable={!isEditing}
              onDragStart={(e) => {
                setDragFrom(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragEnd={endDrag}
              className="flex-shrink-0 w-8 h-8 rounded-lg text-ink-muted hover:bg-paper-warm hover:text-ink cursor-grab active:cursor-grabbing touch-none disabled:opacity-40"
              aria-label={`Drag to reorder ${name}`}
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
                    commitRename(name);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                onBlur={() => commitRename(name)}
                className={`flex-1 min-w-0 rounded-lg border border-ink/15 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 ${labelClassName}`}
                aria-label={`Rename ${name}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => startRename(name)}
                disabled={!onRename}
                className={`text-sm flex-1 min-w-0 truncate text-left ${
                  onRename ? "hover:text-ink cursor-text" : ""
                } ${labelClassName}`}
                title={onRename ? "Click to rename" : undefined}
              >
                {formatLabel(name)}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(name)}
                disabled={removeDisabled?.(name) || isEditing}
                className="flex-shrink-0 w-7 h-7 rounded-full border border-red-200 text-red-700 text-xs hover:bg-red-50 disabled:opacity-40"
                aria-label={`Remove ${name}`}
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
