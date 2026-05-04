"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import {
  deletePersonPhoto,
  deleteOutfit,
  generateVirtualTryOn,
  saveOutfit,
  uploadPersonPhoto,
} from "@/lib/actions/virtual-tryon";

const MAX_PHOTOS = 5;

export type PersonPhotoSummary = {
  id: string;
  imagePath: string;
  label: string | null;
};

export type ItemSummary = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  bestImagePath: string;
};

export type OutfitSummary = {
  id: string;
  name: string;
  itemIds: string[];
};

export type RecentTryOn = {
  id: string;
  resultImagePath: string;
  createdAt: string;
  itemIds: string[];
};

type Props = {
  initialPhotos: PersonPhotoSummary[];
  items: ItemSummary[];
  outfits: OutfitSummary[];
  credits: number;
  recent: RecentTryOn[];
};

type GeneratedResult = {
  resultImagePath: string;
  itemIds: string[];
} | null;

export function TryOnFlow({ initialPhotos, items, outfits, credits: initialCredits, recent }: Props) {
  const [photos, setPhotos] = useState<PersonPhotoSummary[]>(initialPhotos);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(
    initialPhotos[0]?.id ?? null,
  );
  const [outfitState, setOutfits] = useState<OutfitSummary[]>(outfits);
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [credits, setCredits] = useState(initialCredits);
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedResult>(null);
  const [savingOutfit, setSavingOutfit] = useState(false);
  const [outfitNameDraft, setOutfitNameDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemSummary>();
    items.forEach((i) => map.set(i.id, i));
    return map;
  }, [items]);

  const noCredits = credits < 1;
  const canGenerate =
    !!selectedPhotoId && selectedItemIds.length > 0 && !generating && !noCredits;

  function pickOutfit(id: string | null) {
    setSelectedOutfitId(id);
    if (id) {
      const o = outfitState.find((x) => x.id === id);
      if (o) setSelectedItemIds(o.itemIds.filter((iid) => itemsById.has(iid)));
    }
  }

  function toggleItem(id: string) {
    setSelectedOutfitId(null);
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onPickFiles(files: File[]) {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`You can keep up to ${MAX_PHOTOS} photos. Delete one first.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      for (const file of files.slice(0, remaining)) {
        const fd = new FormData();
        fd.append("image", file);
        const res = await uploadPersonPhoto(fd);
        if (!res.ok) {
          setError(res.error);
          break;
        }
        const newPhoto: PersonPhotoSummary = {
          id: res.id,
          imagePath: res.imagePath,
          label: null,
        };
        setPhotos((prev) => {
          const next = [...prev, newPhoto];
          if (!selectedPhotoId) setSelectedPhotoId(newPhoto.id);
          return next;
        });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onDeletePhoto(id: string) {
    const res = await deletePersonPhoto(id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    if (selectedPhotoId === id) {
      setSelectedPhotoId((prev) => {
        const remaining = photos.filter((p) => p.id !== id);
        return remaining[0]?.id ?? null;
      });
    }
  }

  function onGenerate() {
    if (!selectedPhotoId || selectedItemIds.length === 0) return;
    setError(null);
    setResult(null);
    const itemIds = [...selectedItemIds];
    startGenerate(async () => {
      const res = await generateVirtualTryOn({
        personPhotoId: selectedPhotoId,
        itemIds,
        outfitId: selectedOutfitId,
        prompt,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ resultImagePath: res.resultImagePath, itemIds });
      setCredits(res.creditsRemaining);
      router.refresh();
    });
  }

  async function onSaveOutfit() {
    if (selectedItemIds.length === 0) {
      setError("Pick items first.");
      return;
    }
    if (!outfitNameDraft.trim()) return;
    setSavingOutfit(true);
    try {
      const res = await saveOutfit(outfitNameDraft, selectedItemIds);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOutfits((prev) => [
        { id: res.id, name: outfitNameDraft.trim(), itemIds: [...selectedItemIds] },
        ...prev,
      ]);
      setSelectedOutfitId(res.id);
      setOutfitNameDraft("");
    } finally {
      setSavingOutfit(false);
    }
  }

  async function onDeleteOutfit(id: string) {
    const res = await deleteOutfit(id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOutfits((prev) => prev.filter((o) => o.id !== id));
    if (selectedOutfitId === id) setSelectedOutfitId(null);
  }

  return (
    <div className="space-y-10">
      {/* Step 1: person photos */}
      <section className="space-y-3">
        <SectionHeader
          step={1}
          title="Photos of you"
          subtitle={`Upload up to ${MAX_PHOTOS} reference photos. The AI keeps your face, hair, and pose.`}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {photos.map((p) => {
            const isSelected = p.id === selectedPhotoId;
            return (
              <div key={p.id} className="relative group">
                <button
                  type="button"
                  onClick={() => setSelectedPhotoId(p.id)}
                  aria-pressed={isSelected}
                  className={`block w-full rounded-2xl overflow-hidden aspect-[3/4] shadow-tile transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isSelected ? "ring-2 ring-ink" : "ring-1 ring-ink/10 hover:ring-ink/30"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(p.imagePath)}
                    alt={p.label ?? "You"}
                    className="w-full h-full object-cover"
                  />
                </button>
                {isSelected && (
                  <span className="absolute top-2 left-2 bg-ink text-paper text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                    Selected
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDeletePhoto(p.id)}
                  aria-label="Delete photo"
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                >
                  ×
                </button>
              </div>
            );
          })}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-2xl border-2 border-dashed border-ink/15 aspect-[3/4] flex flex-col items-center justify-center text-center text-xs text-ink-muted hover:bg-paper-warm transition disabled:opacity-50"
            >
              <span className="text-2xl mb-1">+</span>
              <span>{uploading ? "Uploading…" : `Add photo (${photos.length}/${MAX_PHOTOS})`}</span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void onPickFiles(files);
          }}
        />
      </section>

      {/* Step 2: outfit / garments */}
      <section className="space-y-4">
        <SectionHeader
          step={2}
          title="Outfit"
          subtitle="Pick a saved outfit, or hand-pick items below."
        />

        {outfitState.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">
              Saved outfits
            </p>
            <div className="flex flex-wrap gap-2">
              {outfitState.map((o) => {
                const valid = o.itemIds.filter((id) => itemsById.has(id));
                if (valid.length === 0) return null;
                const isSelected = selectedOutfitId === o.id;
                return (
                  <div
                    key={o.id}
                    className={`flex items-center gap-1 rounded-full border px-1 transition ${
                      isSelected
                        ? "border-ink bg-ink text-paper"
                        : "border-ink/15 bg-paper-warm hover:border-ink/30"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => pickOutfit(isSelected ? null : o.id)}
                      className="px-3 py-1 text-xs tracking-wide flex items-center gap-2"
                    >
                      <span>{o.name}</span>
                      <span className={isSelected ? "text-paper/70" : "text-ink-muted"}>
                        · {valid.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteOutfit(o.id)}
                      aria-label={`Delete outfit ${o.name}`}
                      className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                        isSelected ? "hover:bg-paper/20" : "hover:bg-ink/10 text-ink-muted"
                      }`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted">
              Items in your closet ({selectedItemIds.length} selected)
            </p>
            {selectedItemIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedItemIds([]);
                  setSelectedOutfitId(null);
                }}
                className="text-[11px] text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Your closet is empty — add items first.
            </p>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {items.map((item) => {
                const selected = selectedItemIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      aria-pressed={selected}
                      className={`relative block w-full rounded-xl overflow-hidden aspect-square transition ${
                        selected
                          ? "ring-2 ring-ink"
                          : "ring-1 ring-ink/10 hover:ring-ink/30"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnailUrl(item.bestImagePath)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                      {selected && (
                        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-ink text-paper text-[10px] flex items-center justify-center">
                          ✓
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-1 bg-gradient-to-t from-ink/80 to-transparent text-white">
                        <div className="text-[10px] truncate">{item.name}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedItemIds.length > 0 && !selectedOutfitId && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={outfitNameDraft}
              onChange={(e) => setOutfitNameDraft(e.target.value)}
              placeholder="Save these items as an outfit (e.g. Brunch fit)"
              className="flex-1 text-xs rounded-lg border border-ink/15 px-3 py-1.5 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
            />
            <button
              type="button"
              onClick={onSaveOutfit}
              disabled={!outfitNameDraft.trim() || savingOutfit}
              className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm transition disabled:opacity-50"
            >
              {savingOutfit ? "Saving…" : "Save outfit"}
            </button>
          </div>
        )}
      </section>

      {/* Step 3: prompt + generate */}
      <section className="space-y-4">
        <SectionHeader
          step={3}
          title="Generate"
          subtitle="Optional: add direction (mood, occasion, lighting). Costs 1 credit."
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. Outdoor café in warm afternoon light. Keep it natural and editorial."
          className="w-full text-sm rounded-xl border border-ink/15 px-3 py-2 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-ink-muted">
            {!selectedPhotoId
              ? "Pick a photo of yourself to start."
              : selectedItemIds.length === 0
                ? "Pick at least one garment."
                : noCredits
                  ? "Out of credits — buy more in Settings."
                  : `Will use ✨ 1 of ${credits} credits.`}
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate try-on"}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}
      </section>

      {/* Result */}
      {(generating || result) && (
        <section className="space-y-3">
          <SectionHeader step={4} title="Result" subtitle="Your virtual try-on." />
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-[3/4] shadow-tile">
              {generating ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <p className="text-sm text-ink-muted">Generating…</p>
                </div>
              ) : result ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(result.resultImagePath)}
                  alt="Virtual try-on result"
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
            {result && (
              <div className="space-y-3 text-sm">
                <p className="text-ink-muted">Garments used</p>
                <ul className="space-y-2">
                  {result.itemIds.map((iid) => {
                    const item = itemsById.get(iid);
                    if (!item) return null;
                    return (
                      <li key={iid} className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-paper-warm flex-shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbnailUrl(item.bestImagePath)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <div className="text-sm">{item.name}</div>
                          <div className="text-[11px] text-ink-muted">
                            {item.brand ?? "—"} · {item.category}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <a
                  href={imageUrl(result.resultImagePath)}
                  download
                  className="inline-block rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm transition"
                >
                  Download image
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <section className="space-y-3">
          <SectionHeader step={null} title="Recent try-ons" subtitle="" />
          <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {recent.map((r) => (
              <li key={r.id}>
                <a
                  href={imageUrl(r.resultImagePath)}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl overflow-hidden aspect-[3/4] shadow-tile bg-paper-warm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(r.resultImagePath)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  step,
  title,
  subtitle,
}: {
  step: number | null;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      {step !== null && (
        <span className="font-serif text-3xl text-ink-muted/70 tabular-nums">
          {String(step).padStart(2, "0")}
        </span>
      )}
      <div>
        <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
