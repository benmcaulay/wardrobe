"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import type { ItemFormValue } from "@/lib/types";
import { updateItem, wearToday, deleteItem } from "./actions";

const AUTOSAVE_MS = 600;

type Props = {
  itemId: string;
  initial: ItemFormValue;
  categories: string[];
  styleTagsList: string[];
};

export function EditForm({ itemId, initial, categories, styleTagsList }: Props) {
  const [value, setValue] = useState<ItemFormValue>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const baselineRef = useRef(JSON.stringify(initial));
  const saveGenRef = useRef(0);
  const prevItemIdRef = useRef(itemId);

  useEffect(() => {
    if (prevItemIdRef.current === itemId) return;
    prevItemIdRef.current = itemId;
    setValue(initial);
    baselineRef.current = JSON.stringify(initial);
    setSavedAt(null);
    setError(null);
  }, [itemId, initial]);

  useEffect(() => {
    const snapshot = JSON.stringify(value);
    if (snapshot === baselineRef.current) return;

    if (!value.name.trim()) {
      setError("Name is required to save");
      return;
    }

    const timer = setTimeout(() => {
      const gen = ++saveGenRef.current;
      void (async () => {
        setSaving(true);
        setError(null);
        const res = await updateItem({ itemId, ...value });
        if (gen !== saveGenRef.current) return;
        setSaving(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        baselineRef.current = snapshot;
        setSavedAt(Date.now());
        router.refresh();
      })();
    }, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [value, itemId, router]);

  async function onWear() {
    startTransition(async () => {
      await wearToday(itemId);
      router.refresh();
    });
  }

  async function onDelete() {
    if (!confirm("Delete this item? This can't be undone.")) return;
    startTransition(async () => {
      await deleteItem(itemId);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onWear}
          className="rounded-full bg-accent text-white px-4 py-2 text-xs tracking-wide hover:bg-accent/90 transition"
        >
          Wear today
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full border border-red-200 text-red-700 px-4 py-2 text-xs tracking-wide hover:bg-red-50 transition ml-auto"
        >
          Delete
        </button>
      </div>

      <div className="flex items-center justify-end min-h-[1.25rem]">
        <p className="text-[11px] text-ink-muted" aria-live="polite">
          {saving ? (
            "Saving…"
          ) : error ? (
            <span className="text-red-700">{error}</span>
          ) : savedAt ? (
            "Saved"
          ) : null}
        </p>
      </div>

      <ItemFormFields
        value={value}
        onChange={(p) => setValue((v) => ({ ...v, ...p }))}
        categories={categories}
        styleTags={styleTagsList}
      />
    </div>
  );
}
