"use client";

import { useMemo, useState, useTransition } from "react";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import { generateTryOnForSelection, saveOutfit } from "./actions";

type Photo = { id: string; imagePath: string; isPrimary: boolean };
type Item = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  originalImagePath: string;
};

type Props = {
  photos: Photo[];
  items: Item[];
  initialSelectedItemIds: string[];
  initialReferencePhotoId: string;
};

type Result = { tryOnId: string; resultImagePath: string };

export function TryOnFlow({ photos, items, initialSelectedItemIds, initialReferencePhotoId }: Props) {
  const [referencePhotoId, setReferencePhotoId] = useState<string>(initialReferencePhotoId);
  const [selected, setSelected] = useState<string[]>(initialSelectedItemIds);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function toggleItem(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onGenerate() {
    setGenerating(true);
    setError(null);
    const res = await generateTryOnForSelection({
      referencePhotoId,
      itemIds: selected,
    });
    setGenerating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ tryOnId: res.tryOnId, resultImagePath: res.resultImagePath });
  }

  function backToPicker() {
    setResult(null);
  }

  if (result) {
    return (
      <ResultView
        result={result}
        selectedItems={selected.map((id) => itemsById.get(id)!).filter(Boolean)}
        onBack={backToPicker}
        onRegenerate={onGenerate}
      />
    );
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-8 items-start">
      <section>
        <h2 className="text-xs uppercase tracking-wide text-ink-muted mb-3">
          Reference photo
        </h2>
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((p) => {
            const active = p.id === referencePhotoId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setReferencePhotoId(p.id)}
                  aria-pressed={active}
                  className={`relative block w-full rounded-xl overflow-hidden aspect-[3/4] shadow-tile transition ${
                    active ? "ring-2 ring-accent" : "ring-1 ring-transparent hover:ring-ink/15"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(p.imagePath)}
                    alt="Reference photo"
                    className="w-full h-full object-cover"
                  />
                  {p.isPrimary && (
                    <span className="absolute top-2 left-2 bg-accent text-white text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                      Primary
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-ink-muted mb-3">
          Add items ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-ink-muted text-sm">Your closet is empty — add pieces first.</p>
        ) : (
          <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {items.map((it) => {
              const active = selected.includes(it.id);
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => toggleItem(it.id)}
                    aria-pressed={active}
                    className={`relative block w-full rounded-xl overflow-hidden aspect-square shadow-tile transition ${
                      active ? "ring-2 ring-accent" : "ring-1 ring-transparent hover:ring-ink/15"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnailUrl(it.originalImagePath)}
                      alt={it.name}
                      className="w-full h-full object-cover"
                    />
                    <span
                      className={`absolute top-2 right-2 w-6 h-6 rounded-full text-xs flex items-center justify-center transition ${
                        active
                          ? "bg-accent text-white"
                          : "bg-white/90 text-ink border border-ink/10"
                      }`}
                      aria-hidden
                    >
                      {active ? "✓" : "+"}
                    </span>
                  </button>
                  <p className="mt-1 text-[11px] truncate">{it.name}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className="lg:sticky lg:top-6 space-y-4 rounded-2xl bg-paper-warm p-5">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted">The outfit</h2>
        {selected.length === 0 ? (
          <p className="text-sm text-ink-muted">No items picked yet.</p>
        ) : (
          <ul className="space-y-2">
            {selected.map((id) => {
              const it = itemsById.get(id);
              if (!it) return null;
              return (
                <li key={id} className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(it.originalImagePath)}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{it.name}</p>
                    <p className="text-[11px] text-ink-muted truncate">{it.brand ?? it.category}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleItem(id)}
                    aria-label={`Remove ${it.name}`}
                    className="text-ink-muted hover:text-ink text-lg leading-none"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || selected.length === 0 || !referencePhotoId}
          className="w-full rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate try-on"}
        </button>
        {generating && (
          <div className="space-y-2 pt-2">
            <Shimmer className="h-3 w-3/4" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        )}
      </aside>
    </div>
  );
}

function ResultView({
  result,
  selectedItems,
  onBack,
  onRegenerate,
}: {
  result: Result;
  selectedItems: Item[];
  onBack: () => void;
  onRegenerate: () => void;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOutfitId, setSavedOutfitId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function onSave() {
    setSaveError(null);
    startSave(async () => {
      const res = await saveOutfit({
        name,
        itemIds: selectedItems.map((i) => i.id),
      });
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setSavedOutfitId(res.outfitId);
      setSaveOpen(false);
    });
  }

  return (
    <div className="grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-8 items-start">
      <div className="rounded-2xl overflow-hidden bg-paper-warm shadow-tile">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(result.resultImagePath)}
          alt="Try-on preview"
          className="w-full h-auto object-contain"
        />
      </div>

      <aside className="space-y-5">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Your preview</h2>
          <p className="text-xs text-ink-muted mt-1">
            Stubbed composite — the real provider will replace this with a photorealistic render.
          </p>
        </div>

        <ul className="space-y-2 rounded-2xl bg-paper-warm p-4">
          {selectedItems.map((it) => (
            <li key={it.id} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl(it.originalImagePath)}
                alt=""
                className="w-10 h-10 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{it.name}</p>
                <p className="text-[11px] text-ink-muted truncate">{it.brand ?? it.category}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs tracking-wide hover:bg-paper-warm transition"
          >
            Regenerate
          </button>
          {savedOutfitId ? (
            <span className="rounded-full bg-accent-soft text-ink px-4 py-2 text-xs">
              Saved as outfit
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="rounded-full bg-accent text-white px-4 py-2 text-xs tracking-wide hover:bg-accent/90 transition"
            >
              Save as outfit
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs tracking-wide hover:bg-paper-warm transition ml-auto"
          >
            Back
          </button>
        </div>

        {saveOpen && !savedOutfitId && (
          <div className="rounded-xl border border-ink/10 p-3 space-y-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-ink-muted">Outfit name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="Saturday brunch"
                className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:bg-paper-warm"
              />
            </label>
            {saveError && (
              <p role="alert" className="text-xs text-red-700">
                {saveError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={saving || !name.trim()}
                className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setSaveOpen(false)}
                className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white ${className}`} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-paper/80 to-transparent" />
    </div>
  );
}
