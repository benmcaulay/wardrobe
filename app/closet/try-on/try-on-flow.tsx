"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditMark } from "@/components/credit-mark";
import { WebcamCaptureModal } from "@/components/webcam-capture-modal";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import {
  deletePersonPhoto,
  deleteOutfit,
  deleteVirtualTryOn,
  enqueueVirtualTryOn,
  getTryOnJobStatus,
  saveOutfit,
  uploadPersonPhoto,
} from "@/lib/actions/virtual-tryon";

/** Poll a queued try-on job until it finishes, or time out (~4 min). */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

const MAX_PHOTOS = 5;

/** Matches server upload validation (`lib/uploads`). */
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

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
  subcategory: string | null;
  bestImagePath: string;
  /** Lowercase blob: name, brand, category, colors, tags, seasons, pattern, material */
  searchHaystack: string;
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
  /** When false, real try-on uses Fashn.ai (no in-app credit cost). */
  tryOnUsesAppCredits?: boolean;
  recent: RecentTryOn[];
};

type GeneratedResult = {
  resultImagePath: string;
  itemIds: string[];
} | null;

export function TryOnFlow({
  initialPhotos,
  items,
  outfits,
  credits: initialCredits,
  tryOnUsesAppCredits = true,
  recent,
}: Props) {
  const [photos, setPhotos] = useState<PersonPhotoSummary[]>(initialPhotos);
  const [recentList, setRecentList] = useState<RecentTryOn[]>(recent);
  const [deletingRecentId, setDeletingRecentId] = useState<string | null>(null);

  // The page sends only the latest six, so after a delete the refreshed prop
  // carries the next one down — adopt it rather than keeping the stale list.
  useEffect(() => {
    setRecentList(recent);
  }, [recent]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(
    initialPhotos[0]?.id ?? null,
  );
  const [outfitState, setOutfits] = useState<OutfitSummary[]>(outfits);
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [credits, setCredits] = useState(initialCredits);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedResult>(null);
  const [savingOutfit, setSavingOutfit] = useState(false);
  const [outfitNameDraft, setOutfitNameDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [garmentSearch, setGarmentSearch] = useState("");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemSummary>();
    items.forEach((i) => map.set(i.id, i));
    return map;
  }, [items]);

  const garmentSearchNorm = garmentSearch.trim().toLowerCase();
  const filteredGarmentItems = useMemo(() => {
    if (!garmentSearchNorm) return [];
    const tokens = garmentSearchNorm.split(/\s+/).filter(Boolean);
    return items.filter((item) => tokens.every((t) => item.searchHaystack.includes(t)));
  }, [items, garmentSearchNorm]);

  const selectedItemsOrdered = useMemo(
    () => selectedItemIds.map((id) => itemsById.get(id)).filter((x): x is ItemSummary => x != null),
    [selectedItemIds, itemsById],
  );

  const noCredits = tryOnUsesAppCredits && credits < 1;
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

  async function onDeleteRecent(id: string) {
    if (!confirm("Delete this try-on image? This can't be undone.")) return;
    setDeletingRecentId(id);
    const res = await deleteVirtualTryOn(id);
    setDeletingRecentId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRecentList((prev) => prev.filter((r) => r.id !== id));
    // Pull the next one into the strip (the page only sends the latest six).
    router.refresh();
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

  async function onGenerate() {
    if (!selectedPhotoId || selectedItemIds.length === 0 || generating) return;
    setError(null);
    setResult(null);
    setGenerating(true);
    const itemIds = [...selectedItemIds];
    try {
      const res = await enqueueVirtualTryOn({
        personPhotoId: selectedPhotoId,
        itemIds,
        outfitId: selectedOutfitId,
        prompt,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Poll the background job until it finishes (or we time out).
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await getTryOnJobStatus(res.jobId);
        if (!status.ok) {
          setError(status.error);
          return;
        }
        if (status.status === "succeeded") {
          setResult({ resultImagePath: status.resultImagePath, itemIds });
          setCredits(status.creditsRemaining);
          router.refresh();
          return;
        }
      }
      setError("This is taking longer than expected. Check your try-on history shortly.");
    } catch {
      setError("Something went wrong starting the try-on. Please try again.");
    } finally {
      setGenerating(false);
    }
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
            <div className="rounded-2xl border-2 border-dashed border-ink/15 aspect-[3/4] flex flex-col items-stretch justify-center gap-2 p-3 text-center">
              <button
                type="button"
                onClick={() => setWebcamOpen(true)}
                disabled={uploading}
                className="rounded-xl bg-ink text-paper px-2 py-2 text-[11px] tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
                aria-label="Take photo with camera"
              >
                {uploading ? "Uploading…" : "Take photo"}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-xl border border-ink/15 bg-white px-2 py-2 text-[11px] text-ink hover:bg-paper-warm transition disabled:opacity-50"
                aria-label="Choose photos from library or files"
              >
                Choose files
              </button>
              <span className="text-[10px] text-ink-muted pt-1">
                {photos.length}/{MAX_PHOTOS}
              </span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="hidden"
          aria-hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void onPickFiles(files);
          }}
        />
        <WebcamCaptureModal
          open={webcamOpen}
          preferredFacing="user"
          title="Take a photo"
          onClose={() => setWebcamOpen(false)}
          onCapture={(file) => void onPickFiles([file])}
        />
      </section>

      {/* Step 2: outfit / garments */}
      <section className="space-y-4">
        <SectionHeader
          step={2}
          title="Outfit"
          subtitle="Pick a saved outfit, or search your closet and tap items to add."
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

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted">
              Garments ({selectedItemIds.length} selected)
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
                Clear all
              </button>
            )}
          </div>

          {selectedItemsOrdered.length > 0 && (
            <div className="rounded-xl border border-ink/10 bg-paper-warm p-2">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2 px-1">
                Selected
              </p>
              <ul className="flex flex-wrap gap-2">
                {selectedItemsOrdered.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white pl-1 pr-0.5 py-0.5 max-w-[220px]">
                      <div className="w-9 h-9 rounded-md overflow-hidden bg-paper-warm flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl(item.bestImagePath)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="text-[11px] truncate flex-1 min-w-0">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        aria-label={`Remove ${item.name}`}
                        className="w-7 h-7 flex-shrink-0 rounded-md text-ink-muted hover:bg-paper-warm hover:text-ink text-sm"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Your closet is empty — add items first.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="sr-only">Search closet</span>
                <input
                  type="search"
                  value={garmentSearch}
                  onChange={(e) => setGarmentSearch(e.target.value)}
                  placeholder="Search name, brand, category, color, pattern, season, tags…"
                  autoComplete="off"
                  className="w-full text-sm rounded-xl border border-ink/15 px-3 py-2.5 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
                />
              </label>
              {!garmentSearchNorm ? null : filteredGarmentItems.length === 0 ? (
                <p className="text-sm text-ink-muted">No matches. Try fewer or different words.</p>
              ) : (
                <>
                  <p className="text-[11px] text-ink-muted">
                    {filteredGarmentItems.length} match
                    {filteredGarmentItems.length === 1 ? "" : "es"}
                  </p>
                  <div className="max-h-[min(55vh,520px)] overflow-y-auto rounded-xl border border-ink/10 bg-paper-warm p-3">
                    <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                      {filteredGarmentItems.map((item) => {
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
                  </div>
                </>
              )}
            </>
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
          subtitle={
            tryOnUsesAppCredits
              ? "Optional: add direction (mood, occasion, lighting). Costs 1 app credit."
              : "Optional: add notes (saved with the try-on). Generation uses your Fashn.ai plan — no app credits."
          }
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
            {!selectedPhotoId ? (
              "Pick a photo of yourself to start."
            ) : selectedItemIds.length === 0 ? (
              "Pick at least one garment."
            ) : noCredits ? (
              "Out of credits — buy more in Settings."
            ) : tryOnUsesAppCredits ? (
              <span className="inline-flex items-center gap-1">
                <CreditMark className="h-3 w-3 shrink-0" />
                <span>{`Will use 1 of ${credits} app credits.`}</span>
              </span>
            ) : (
              "Uses your Fashn.ai API key (no app credits)."
            )}
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
      {recentList.length > 0 && (
        <section className="space-y-3">
          <SectionHeader step={null} title="Recent try-ons" subtitle="" />
          <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {recentList.map((r) => (
              <li key={r.id} className="relative group">
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
                <button
                  type="button"
                  onClick={() => onDeleteRecent(r.id)}
                  disabled={deletingRecentId === r.id}
                  aria-label="Delete try-on image"
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-60"
                >
                  {deletingRecentId === r.id ? "…" : "\u00d7"}
                </button>
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
