"use client";

import { useRef, useState } from "react";
import { imageUrl } from "@/lib/image-paths";
import { BAG_SILHOUETTES, getSilhouette } from "@/lib/packing/silhouettes";
import { formatVolume } from "@/lib/packing/estimate";
import { createBag, deleteBag, updateBag, uploadBagImage } from "../actions";

export type BagView = {
  id: string;
  name: string;
  volumeLiters: number;
  maxWeightKg: number | null;
  silhouette: string;
  imagePath: string | null;
};

type Draft = {
  name: string;
  silhouette: string;
  volumeLiters: string;
  maxWeightKg: string;
  imagePath: string | null;
};

function emptyDraft(): Draft {
  const def = getSilhouette(null);
  return {
    name: "",
    silhouette: def.id,
    volumeLiters: String(def.typicalLiters),
    maxWeightKg: "",
    imagePath: null,
  };
}

function bagToDraft(bag: BagView): Draft {
  return {
    name: bag.name,
    silhouette: bag.silhouette,
    volumeLiters: String(bag.volumeLiters),
    maxWeightKg: bag.maxWeightKg == null ? "" : String(bag.maxWeightKg),
    imagePath: bag.imagePath,
  };
}

export function BagsClient({ initial }: { initial: BagView[] }) {
  const [bags, setBags] = useState<BagView[]>(initial);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bags.map((bag) =>
          editingId === bag.id ? (
            <li key={bag.id}>
              <BagForm
                initialDraft={bagToDraft(bag)}
                submitLabel="Save changes"
                onCancel={() => setEditingId(null)}
                onSubmit={async (draft) => {
                  const res = await updateBag({ id: bag.id, ...toInput(draft) });
                  if (!res.ok) return res.error;
                  setBags((prev) =>
                    prev.map((b) => (b.id === bag.id ? { ...b, ...viewFromDraft(bag.id, draft) } : b)),
                  );
                  setEditingId(null);
                  return null;
                }}
              />
            </li>
          ) : (
            <li key={bag.id}>
              <BagCard
                bag={bag}
                onEdit={() => {
                  setAdding(false);
                  setEditingId(bag.id);
                }}
                onDelete={async () => {
                  const res = await deleteBag(bag.id);
                  if (res.ok) setBags((prev) => prev.filter((b) => b.id !== bag.id));
                }}
              />
            </li>
          ),
        )}

        <li>
          {adding ? (
            <BagForm
              initialDraft={emptyDraft()}
              submitLabel="Add bag"
              onCancel={() => setAdding(false)}
              onSubmit={async (draft) => {
                const res = await createBag(toInput(draft));
                if (!res.ok) return res.error;
                setBags((prev) => [...prev, viewFromDraft(res.id, draft)]);
                setAdding(false);
                return null;
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
              className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 bg-paper-warm/40 text-ink-muted transition hover:border-ink/40 hover:text-ink"
            >
              <span className="text-3xl leading-none">+</span>
              <span className="text-sm tracking-wide">Add a bag</span>
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}

function toInput(draft: Draft) {
  return {
    name: draft.name,
    silhouette: draft.silhouette,
    volumeLiters: Number(draft.volumeLiters),
    maxWeightKg: draft.maxWeightKg.trim() === "" ? null : Number(draft.maxWeightKg),
    imagePath: draft.imagePath,
  };
}

function viewFromDraft(id: string, draft: Draft): BagView {
  return {
    id,
    name: draft.name.trim(),
    silhouette: draft.silhouette,
    volumeLiters: Math.round(Number(draft.volumeLiters) * 10) / 10,
    maxWeightKg: draft.maxWeightKg.trim() === "" ? null : Number(draft.maxWeightKg),
    imagePath: draft.imagePath,
  };
}

function BagCard({
  bag,
  onEdit,
  onDelete,
}: {
  bag: BagView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const silhouette = getSilhouette(bag.silhouette);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-surface shadow-tile">
      <div className="flex h-40 items-center justify-center bg-paper-warm">
        {bag.imagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(bag.imagePath)} alt={bag.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs uppercase tracking-[0.18em] text-ink-muted">
            {silhouette.label}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="font-medium">{bag.name}</div>
        <div className="mt-1 text-sm text-ink-muted">
          {formatVolume(bag.volumeLiters)}
          {bag.maxWeightKg != null ? ` · ${bag.maxWeightKg} kg max` : ""}
        </div>
        <div className="mt-auto flex gap-2 pt-4">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper-warm"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full px-3 py-1.5 text-xs text-rose-700 transition hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function BagForm({
  initialDraft,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialDraft: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickSilhouette(id: string) {
    const sil = getSilhouette(id);
    setDraft((d) => ({
      ...d,
      silhouette: id,
      // Only auto-fill volume if the field is empty or untouched-default.
      volumeLiters: d.volumeLiters.trim() === "" ? String(sil.typicalLiters) : d.volumeLiters,
    }));
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("image", file);
    const res = await uploadBagImage(fd);
    setUploading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft((d) => ({ ...d, imagePath: res.imagePath }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const err = await onSubmit(draft);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-ink/15 bg-surface p-4 shadow-tile">
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Name</label>
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Carry-on, weekend duffel…"
          className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Shape</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {BAG_SILHOUETTES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickSilhouette(s.id)}
              aria-pressed={draft.silhouette === s.id}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                draft.silhouette === s.id
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
            Volume (L)
          </label>
          <input
            value={draft.volumeLiters}
            onChange={(e) => setDraft((d) => ({ ...d, volumeLiters: e.target.value }))}
            inputMode="decimal"
            placeholder="40"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
            Weight cap (kg)
          </label>
          <input
            value={draft.maxWeightKg}
            onChange={(e) => setDraft((d) => ({ ...d, maxWeightKg: e.target.value }))}
            inputMode="decimal"
            placeholder="optional"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
          Photo (optional)
        </label>
        <div className="mt-1 flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-paper-warm">
            {draft.imagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(draft.imagePath)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
          >
            {uploading ? "Uploading…" : draft.imagePath ? "Replace" : "Upload"}
          </button>
          {draft.imagePath ? (
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, imagePath: null }))}
              className="text-xs text-ink-muted underline hover:text-ink"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}

      <div className="mt-auto flex gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy ? "Saving…" : submitLabel}
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
