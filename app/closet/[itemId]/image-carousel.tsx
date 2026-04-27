"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import { generateGhostViewFor } from "@/lib/actions/ghost-mannequin";

type GhostView = { label: string; imagePath: string };
type PickImageState = { selectedExtraPaths: string[]; label: string };

type Props = {
  itemId: string;
  originalPath: string;
  ghostViews: GhostView[];
  extraImagePaths: string[];
  credits: number;
};

export function ImageCarousel({
  itemId,
  originalPath,
  ghostViews: initialGhostViews,
  extraImagePaths,
  credits,
}: Props) {
  const [ghostViews, setGhostViews] = useState(initialGhostViews);
  // null = original, index = ghost view index
  const [activeIndex, setActiveIndex] = useState<"original" | number>(
    initialGhostViews.length > 0 ? 0 : "original",
  );
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickingImages, setPickingImages] = useState<PickImageState | null>(null);
  const router = useRouter();
  const noCredits = credits < 1;

  const activeGhost = activeIndex !== "original" ? ghostViews[activeIndex] ?? null : null;
  const activeSrc = activeGhost ? imageUrl(activeGhost.imagePath) : imageUrl(originalPath);
  const activeAlt = activeGhost ? activeGhost.label : "Original";

  function requestGenerate() {
    setError(null);
    if (extraImagePaths.length > 0) {
      setPickingImages({ selectedExtraPaths: [...extraImagePaths], label: "" });
    } else {
      doGenerate([], "");
    }
  }

  function doGenerate(selectedExtras: string[], label: string) {
    setPickingImages(null);
    startGenerate(async () => {
      const currentViews = ghostViews;
      const res = await generateGhostViewFor(itemId, selectedExtras, label);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const defaultLabel =
        currentViews.length === 0 ? "Ghost" : `View ${currentViews.length + 1}`;
      const newView: GhostView = {
        label: label.trim() || defaultLabel,
        imagePath: res.ghostImagePath,
      };
      setGhostViews((prev) => {
        const next = [...prev, newView];
        setActiveIndex(next.length - 1);
        return next;
      });
      router.refresh();
    });
  }

  const hasGhosts = ghostViews.length > 0;

  return (
    <div className="space-y-3">
      {/* Main image */}
      <div className="rounded-2xl overflow-hidden aspect-square shadow-tile bg-paper-warm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeSrc} alt={activeAlt} className="w-full h-full object-cover" />
      </div>

      {/* Thumbnail row */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <ViewThumb
          src={imageUrl(originalPath)}
          label="Original"
          active={activeIndex === "original"}
          onClick={() => setActiveIndex("original")}
        />
        {ghostViews.map((view, i) => (
          <ViewThumb
            key={view.imagePath}
            src={imageUrl(view.imagePath)}
            label={view.label}
            active={activeIndex === i}
            onClick={() => setActiveIndex(i)}
          />
        ))}
        {generating && (
          <div className="flex-shrink-0 w-16 flex flex-col items-center gap-1 rounded-xl border border-ink/10 p-1 animate-pulse">
            <div className="w-full aspect-square rounded bg-paper-warm" />
            <span className="text-[9px] text-ink-muted">…</span>
          </div>
        )}
      </div>

      {/* Image picker for generating a new view */}
      {pickingImages ? (
        <ImagePickerPanel
          originalPath={originalPath}
          extraImagePaths={extraImagePaths}
          pickState={pickingImages}
          generating={generating}
          onChange={setPickingImages}
          onGenerate={() =>
            doGenerate(pickingImages.selectedExtraPaths, pickingImages.label)
          }
          onCancel={() => setPickingImages(null)}
        />
      ) : (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-xs">
            <span className="font-medium">
              {hasGhosts ? "Ghost-mannequin views" : "Ghost-mannequin photo"}
            </span>{" "}
            {hasGhosts
              ? `· ${ghostViews.length} generated`
              : "not generated yet."}
          </p>
          <p className="text-[11px] text-ink-muted">
            {noCredits
              ? "Out of credits — buy more in Settings."
              : `Costs 1 credit (you have ✨ ${credits}).${
                  extraImagePaths.length > 0
                    ? " You can select which source images to use."
                    : ""
                }`}
          </p>
          <button
            type="button"
            onClick={requestGenerate}
            disabled={generating || noCredits}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {generating
              ? "Generating…"
              : hasGhosts
                ? "Generate another view"
                : "Generate ghost mannequin"}
          </button>
          {error && (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ViewThumb({
  src,
  label,
  active,
  onClick,
}: {
  src: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-shrink-0 w-16 flex flex-col items-center gap-1 rounded-xl border p-1 transition ${
        active ? "border-ink bg-paper-warm" : "border-ink/10 hover:border-ink/30"
      }`}
    >
      <div className="w-full aspect-square rounded overflow-hidden bg-paper-warm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="w-full h-full object-cover" />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-ink-muted truncate w-full text-center px-0.5">
        {label}
      </span>
    </button>
  );
}

function ImagePickerPanel({
  originalPath,
  extraImagePaths,
  pickState,
  generating,
  onChange,
  onGenerate,
  onCancel,
}: {
  originalPath: string;
  extraImagePaths: string[];
  pickState: PickImageState;
  generating: boolean;
  onChange: (s: PickImageState) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const toggleExtra = (path: string) => {
    const sel = pickState.selectedExtraPaths;
    onChange({
      ...pickState,
      selectedExtraPaths: sel.includes(path) ? sel.filter((p) => p !== path) : [...sel, path],
    });
  };

  return (
    <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-3">
      <p className="text-xs font-medium">Select images for this view</p>

      {/* Original — always included */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded flex items-center justify-center bg-ink/10 border border-ink/20 flex-shrink-0">
          <svg className="w-3 h-3 text-ink" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7z" />
          </svg>
        </div>
        <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(originalPath)}
            alt="Garment"
            className="w-full h-full object-cover"
          />
        </div>
        <span className="text-xs text-ink-muted">Garment photo (always included)</span>
      </div>

      {extraImagePaths.map((path) => {
        const selected = pickState.selectedExtraPaths.includes(path);
        return (
          <label key={path} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleExtra(path)}
              className="w-4 h-4 rounded accent-ink flex-shrink-0"
            />
            <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(path)} alt="" className="w-full h-full object-cover" />
            </div>
            <span className="text-xs text-ink-muted">Source image</span>
          </label>
        );
      })}

      <input
        type="text"
        placeholder="Label this view (e.g. Front, Back, Inside…)"
        value={pickState.label}
        onChange={(e) => onChange({ ...pickState, label: e.target.value })}
        className="w-full text-xs rounded-lg border border-ink/15 px-3 py-1.5 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
      />

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
