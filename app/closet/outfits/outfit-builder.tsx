"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import { deleteOutfitLayout, saveOutfitLayout } from "./actions";

export type OutfitClosetItem = {
  id: string;
  name: string;
  category: string;
  imagePath: string;
};

type PlacedPiece = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  scale: number;
  z: number;
};

type SavedOutfit = {
  id: string;
  name: string;
  frameHeight: number;
  pieces: PlacedPiece[];
};

type Props = {
  items: OutfitClosetItem[];
  initialOutfits: SavedOutfit[];
};
export type { SavedOutfit };
const BASE_PIECE_SIZE = 180;
const FRAME_WIDTH = 560;
/** Filter items in the None / uncategorized bucket (legacy empty string allowed). */
const FILTER_CATEGORY_NONE = "__none__";
const FRAME_MIN_HEIGHT = 520;
const FRAME_MAX_HEIGHT = 820;

export function OutfitBuilder({ items, initialOutfits }: Props) {
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(640);
  const [category, setCategory] = useState("");
  const [outfitName, setOutfitName] = useState("");
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>(initialOutfits);
  const [dragState, setDragState] = useState<{ pieceId: string; dx: number; dy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [processedImageUrls, setProcessedImageUrls] = useState<Record<string, string>>({});
  const urlRegistryRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of urlRegistryRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const itemsById = useMemo(() => {
    const map = new Map<string, OutfitClosetItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!category) return items;
    if (category === FILTER_CATEGORY_NONE) {
      return items.filter((item) => isNoneCategoryStored(item.category));
    }
    return items.filter((item) => item.category === category);
  }, [items, category]);

  const { hasUncategorized, namedCategories } = useMemo(() => {
    const hasUncategorized = items.some((item) => isNoneCategoryStored(item.category));
    const namedCategories = [
      ...new Set(
        items
          .map((item) => item.category.trim())
          .filter(Boolean)
          .filter((c) => !isNoneCategoryStored(c)),
      ),
    ].sort((a, b) => a.localeCompare(b));
    return { hasUncategorized, namedCategories };
  }, [items]);

  const selected = pieces.find((piece) => piece.id === selectedPieceId) ?? null;

  function nextZ(): number {
    return pieces.length === 0 ? 1 : Math.max(...pieces.map((p) => p.z)) + 1;
  }

  async function getProcessedUrl(item: OutfitClosetItem): Promise<string> {
    if (processedImageUrls[item.id]) return processedImageUrls[item.id]!;
    const src = imageUrl(item.imagePath);
    const out = await removeWhiteBackground(src);
    urlRegistryRef.current.push(out);
    setProcessedImageUrls((prev) => ({ ...prev, [item.id]: out }));
    return out;
  }

  async function addPiece(item: OutfitClosetItem) {
    await getProcessedUrl(item);
    const id = crypto.randomUUID();
    const piece: PlacedPiece = {
      id,
      itemId: item.id,
      x: FRAME_WIDTH / 2,
      y: frameHeight / 2,
      scale: 1,
      z: nextZ(),
    };
    setPieces((prev) => [...prev, piece]);
    setSelectedPieceId(id);
  }

  function updateSelectedScale(scale: number) {
    if (!selected) return;
    setPieces((prev) => prev.map((p) => (p.id === selected.id ? { ...p, scale } : p)));
  }

  function moveLayer(dir: -1 | 1) {
    if (!selected) return;
    setPieces((prev) => {
      const sorted = [...prev].sort((a, b) => a.z - b.z);
      const idx = sorted.findIndex((p) => p.id === selected.id);
      const nextIdx = idx + dir;
      if (idx < 0 || nextIdx < 0 || nextIdx >= sorted.length) return prev;
      const a = sorted[idx]!;
      const b = sorted[nextIdx]!;
      return prev.map((p) => {
        if (p.id === a.id) return { ...p, z: b.z };
        if (p.id === b.id) return { ...p, z: a.z };
        return p;
      });
    });
  }

  function removeSelected() {
    if (!selected) return;
    setPieces((prev) => prev.filter((p) => p.id !== selected.id));
    setSelectedPieceId(null);
  }

  function saveOutfit() {
    const name = outfitName.trim();
    if (!name || pieces.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await saveOutfitLayout({ name, frameHeight, pieces });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const record: SavedOutfit = {
        id: res.id,
        name,
        frameHeight,
        pieces,
      };
      setSavedOutfits((prev) => [record, ...prev].slice(0, 30));
      setOutfitName("");
    });
  }

  function loadOutfit(outfit: SavedOutfit) {
    setFrameHeight(outfit.frameHeight);
    setPieces(outfit.pieces);
    setSelectedPieceId(outfit.pieces[0]?.id ?? null);
    for (const piece of outfit.pieces) {
      const item = itemsById.get(piece.itemId);
      if (item) void getProcessedUrl(item);
    }
  }

  function removeOutfit(outfitId: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteOutfitLayout(outfitId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedOutfits((prev) => prev.filter((o) => o.id !== outfitId));
    });
  }

  function handlePiecePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    piece: PlacedPiece,
  ) {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rx = rect.width * 0.25;
    const ry = rect.height * 0.25;
    const withinReducedHitbox =
      ((px - cx) * (px - cx)) / (rx * rx) + ((py - cy) * (py - cy)) / (ry * ry) <= 1;
    if (!withinReducedHitbox) return;

    const frame = target.parentElement;
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();

    setSelectedPieceId(piece.id);
    // Store drag offset in frame-local coordinates to avoid initial jump.
    setDragState({
      pieceId: piece.id,
      dx: e.clientX - frameRect.left - piece.x,
      dy: e.clientY - frameRect.top - piece.y,
    });
    target.setPointerCapture(e.pointerId);
  }

  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    const frameRect = e.currentTarget.getBoundingClientRect();
    const x = clamp(e.clientX - frameRect.left - dragState.dx, 0, FRAME_WIDTH);
    const y = clamp(e.clientY - frameRect.top - dragState.dy, 0, frameHeight);
    setPieces((prev) =>
      prev.map((piece) => (piece.id === dragState.pieceId ? { ...piece, x, y } : piece)),
    );
  }

  function handleCanvasPointerUp() {
    setDragState(null);
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
      <section>
        {savedOutfits.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {savedOutfits.map((outfit) => (
              <div key={outfit.id} className="flex items-center rounded-full border border-ink/10 bg-white pr-1">
                <button
                  type="button"
                  onClick={() => loadOutfit(outfit)}
                  className="px-3 py-1 text-xs hover:text-ink"
                >
                  {outfit.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeOutfit(outfit.id)}
                  className="w-5 h-5 rounded-full text-xs text-ink-muted hover:bg-ink/10 hover:text-ink"
                  aria-label={`Delete ${outfit.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-3">
          <label className="text-xs text-ink-muted">Frame height</label>
          <input
            type="range"
            min={FRAME_MIN_HEIGHT}
            max={FRAME_MAX_HEIGHT}
            value={frameHeight}
            onChange={(e) => setFrameHeight(Number(e.target.value))}
            className="w-56 accent-ink"
          />
          <span className="text-xs text-ink-muted">{frameHeight}px</span>
        </div>

        <div
          className="relative surface-canvas rounded-2xl border border-ink/10 overflow-hidden shadow-tile"
          style={{ width: FRAME_WIDTH, height: frameHeight }}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerLeave={handleCanvasPointerUp}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-paper-warm/70 to-white" />
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-8 w-40 rounded-full border border-ink/10 bg-paper/70"
            style={{ height: Math.max(220, frameHeight * 0.7) }}
          />
          {pieces
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((piece) => {
              const item = itemsById.get(piece.itemId);
              if (!item) return null;
              const src = processedImageUrls[item.id] ?? imageUrl(item.imagePath);
              const size = BASE_PIECE_SIZE * piece.scale;
              const isSelected = piece.id === selectedPieceId;
              return (
                <button
                  key={piece.id}
                  type="button"
                  onPointerDown={(e) => handlePiecePointerDown(e, piece)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                    isSelected ? "ring-1 ring-ink/30 rounded-xl" : ""
                  }`}
                  style={{ left: piece.x, top: piece.y, zIndex: piece.z, width: size, height: size }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={item.name} className="w-full h-full object-contain select-none" draggable={false} />
                </button>
              );
            })}
        </div>
        <p className="text-[11px] text-ink-muted mt-2">
          Near-white pixels (`#f0f0f0` and above) are made transparent for cleaner layering.
        </p>
      </section>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-ink/10 bg-white p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-muted">Outfit</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={outfitName}
              onChange={(e) => setOutfitName(e.target.value)}
              placeholder="Outfit name"
              className="w-full rounded-full border border-ink/10 px-3 py-1.5 text-xs bg-paper"
            />
            <button
              type="button"
              onClick={saveOutfit}
              disabled={!outfitName.trim() || pieces.length === 0 || pending}
              className="rounded-full bg-ink text-paper px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-700">{error}</p>}
          {selected ? (
            <div className="space-y-2 pt-1">
              <label className="block text-[10px] uppercase tracking-wide text-ink-muted">
                Piece size
              </label>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.05}
                value={selected.scale}
                onChange={(e) => updateSelectedScale(Number(e.target.value))}
                className="w-full accent-ink"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveLayer(-1)}
                  className="rounded-full border border-ink/15 px-3 py-1 text-xs"
                >
                  Send back
                </button>
                <button
                  type="button"
                  onClick={() => moveLayer(1)}
                  className="rounded-full border border-ink/15 px-3 py-1 text-xs"
                >
                  Bring forward
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="rounded-full border border-red-200 text-red-700 px-3 py-1 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Select a piece on the frame to edit it.</p>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">Your closet</div>
            <button
              type="button"
              onClick={() => {
                setPieces([]);
                setSelectedPieceId(null);
              }}
              className="text-[10px] text-ink-muted hover:text-ink"
            >
              Clear canvas
            </button>
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-full border border-ink/10 px-3 py-1.5 text-xs bg-white"
          >
            <option value="">All categories</option>
            {hasUncategorized && (
              <option value={FILTER_CATEGORY_NONE}>{NONE_CATEGORY}</option>
            )}
            {namedCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ul className="space-y-2 max-h-[480px] overflow-auto pr-1">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void addPiece(item)}
                  className="w-full rounded-xl bg-white border border-ink/10 hover:border-ink/25 p-2 flex items-center gap-2 text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(item.imagePath)}
                    alt=""
                    className="w-10 h-10 rounded object-cover bg-paper-warm flex-shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-xs block truncate">{item.name}</span>
                    <span className="text-[10px] text-ink-muted">
                      {isNoneCategoryStored(item.category) ? NONE_CATEGORY : item.category}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

async function removeWhiteBackground(src: string): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! >= 240 && px[i + 1]! >= 240 && px[i + 2]! >= 240) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return src;
  return URL.createObjectURL(blob);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
