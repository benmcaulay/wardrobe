"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import type { ItemFormValue } from "@/lib/types";
import { updateItem, wearToday, deleteItem } from "./actions";

type Props = {
  itemId: string;
  initial: ItemFormValue;
};

export function EditForm({ itemId, initial }: Props) {
  const [value, setValue] = useState<ItemFormValue>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await updateItem({ itemId, ...value });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedAt(Date.now());
    router.refresh();
  }

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
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onWear}
          className="rounded-full bg-accent text-white px-4 py-2 text-xs tracking-wide hover:bg-accent/90 transition"
        >
          Wear today
        </button>
        <a
          href={`/try-on?item=${itemId}`}
          className="rounded-full border border-ink/15 px-4 py-2 text-xs tracking-wide hover:bg-paper-warm transition"
        >
          Try on me
        </a>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full border border-red-200 text-red-700 px-4 py-2 text-xs tracking-wide hover:bg-red-50 transition ml-auto"
        >
          Delete
        </button>
      </div>

      <ItemFormFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} disabled={saving} />

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !dirty || !value.name.trim()}
          className="rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!dirty && savedAt && (
          <span className="text-xs text-ink-muted">Saved</span>
        )}
      </div>
    </form>
  );
}
