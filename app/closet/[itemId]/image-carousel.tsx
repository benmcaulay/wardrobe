"use client";

import { useEffect, useRef, useState, useTransition, startTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import {
  deleteGhostViewFor,
  addExtraSourceImageFor,
  enqueueGhostViewFor,
  getGhostJobStatus,
  getPendingGhostViewJobForItem,
  setPrimaryThumbnailFor,
  updateGhostViewStyleFor,
  updateOriginalStyleFor,
  replaceGhostViewImageWithCrop,
  replaceOriginalImageWithEdit,
  type GhostViewStyle,
} from "@/lib/actions/ghost-mannequin";
import { CreditMark } from "@/components/credit-mark";
import { ImageCropper } from "@/components/image-cropper";
import { BackgroundWhitener } from "@/components/background-whitener";

type GhostView = { label: string; imagePath: string; mirror?: boolean; thumbZoom?: number };
type PickImageState = {
  selectedExtraPaths: string[];
  label: string;
  instructions: string;
  /** `null` = listing photo is the model's first input */
  primaryPath: string | null;
  compositionHint: "default" | "rear";
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

type Props = {
  itemId: string;
  originalPath: string;
  originalThumbZoom?: number;
  originalMirror?: boolean;
  ghostViews: GhostView[];
  primaryGhostPath: string | null;
  extraImagePaths: string[];
  credits: number;
};

export function ImageCarousel({
  itemId,
  originalPath,
  originalThumbZoom = 1,
  originalMirror = false,
  ghostViews: initialGhostViews,
  primaryGhostPath,
  extraImagePaths,
  credits,
}: Props) {
  const [ghostViews, setGhostViews] = useState(initialGhostViews);
  const [origPath, setOrigPath] = useState(originalPath);
  const [whitening, setWhitening] = useState(false);
  const [originalStyle, setOriginalStyle] = useState({
    mirror: originalMirror,
    thumbZoom: originalThumbZoom,
  });
  const [primaryPath, setPrimaryPath] = useState<string | null>(primaryGhostPath);
  // null = original, index = ghost view index
  const [activeIndex, setActiveIndex] = useState<"original" | number>(
    initialGhostViews.length > 0 ? 0 : "original",
  );
  const [sourceImagePaths, setSourceImagePaths] = useState(extraImagePaths);
  const [ghostGenerating, setGhostGenerating] = useState(false);
  const [, startTransition] = useTransition();
  const pollGenRef = useRef(0);
  const prevGhostCountRef = useRef(initialGhostViews.length);
  const [error, setError] = useState<string | null>(null);
  const [pickingImages, setPickingImages] = useState<PickImageState | null>(null);
  const [croppingPath, setCroppingPath] = useState<string | null>(null);
  const [croppingOriginal, setCroppingOriginal] = useState(false);
  const router = useRouter();
  const noCredits = credits < 1;

  useEffect(() => {
    setGhostViews(initialGhostViews);
    if (initialGhostViews.length > prevGhostCountRef.current) {
      setActiveIndex(initialGhostViews.length - 1);
    }
    prevGhostCountRef.current = initialGhostViews.length;
  }, [initialGhostViews]);

  useEffect(() => {
    setPrimaryPath(primaryGhostPath);
  }, [primaryGhostPath]);

  useEffect(() => {
    setSourceImagePaths(extraImagePaths);
  }, [extraImagePaths]);

  useEffect(() => {
    setOrigPath(originalPath);
  }, [originalPath]);

  const activeGhost = activeIndex !== "original" ? ghostViews[activeIndex] ?? null : null;
  const activeSrc = activeGhost ? imageUrl(activeGhost.imagePath) : imageUrl(origPath);
  const activeAlt = activeGhost ? activeGhost.label : "Original";
  const activeTransform = activeGhost
    ? `scale(${activeGhost.thumbZoom ?? 1}) ${activeGhost.mirror ? "scaleX(-1)" : ""}`
    : `scale(${originalStyle.thumbZoom}) ${originalStyle.mirror ? "scaleX(-1)" : ""}`;

  function requestGenerate() {
    setError(null);
    setPickingImages({
      selectedExtraPaths: [...sourceImagePaths],
      label: "Front",
      instructions: "",
      primaryPath: null,
      compositionHint: "default",
    });
  }

  async function addSourceImage(file: File) {
    const formData = new FormData();
    formData.append("image", file);
    const res = await addExtraSourceImageFor(itemId, formData);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSourceImagePaths((prev) => (prev.includes(res.imagePath) ? prev : [...prev, res.imagePath]));
    setPickingImages((prev) =>
      prev && !prev.selectedExtraPaths.includes(res.imagePath)
        ? { ...prev, selectedExtraPaths: [...prev.selectedExtraPaths, res.imagePath] }
        : prev,
    );
    router.refresh();
  }

  function dismissGenerateModal() {
    setPickingImages(null);
  }

  async function pollGhostJob(jobId: string, signal: number) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (pollGenRef.current !== signal) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (pollGenRef.current !== signal) return;
      const status = await getGhostJobStatus(jobId);
      if (pollGenRef.current !== signal) return;
      if (!status.ok) {
        setError(status.error);
        return;
      }
      if (status.status === "succeeded") {
        setPickingImages(null);
        router.refresh();
        return;
      }
    }
    setError("This is taking longer than expected. Check back on this item shortly.");
  }

  function startGhostPoll(jobId: string) {
    setGhostGenerating(true);
    const signal = ++pollGenRef.current;
    void pollGhostJob(jobId, signal).finally(() => {
      if (pollGenRef.current === signal) setGhostGenerating(false);
    });
  }

  useEffect(() => {
    void (async () => {
      const pending = await getPendingGhostViewJobForItem(itemId);
      if (pending.ok && pending.jobId) startGhostPoll(pending.jobId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per item
  }, [itemId]);

  function doGenerate(pick: PickImageState) {
    setError(null);
    setGhostGenerating(true);
    void enqueueGhostViewFor(
      itemId,
      pick.selectedExtraPaths,
      pick.label,
      pick.instructions,
      pick.primaryPath,
      pick.compositionHint,
    )
      .then((res) => {
        if (!res.ok) {
          setError(res.error);
          setGhostGenerating(false);
          return;
        }
        startGhostPoll(res.jobId);
      })
      .catch(() => {
        setError("Something went wrong starting ghost generation. Please try again.");
        setGhostGenerating(false);
      });
  }

  function setPrimary(imagePath: string | null) {
    startTransition(async () => {
      const res = await setPrimaryThumbnailFor(itemId, imagePath);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPrimaryPath(imagePath);
      router.refresh();
    });
  }

  function patchStyle(imagePath: string, patch: GhostViewStyle) {
    setGhostViews((prev) =>
      prev.map((v) =>
        v.imagePath === imagePath
          ? {
              ...v,
              mirror: typeof patch.mirror === "boolean" ? patch.mirror : v.mirror,
              thumbZoom: typeof patch.thumbZoom === "number" ? patch.thumbZoom : v.thumbZoom,
            }
          : v,
      ),
    );
    startTransition(async () => {
      const next = ghostViews.find((v) => v.imagePath === imagePath);
      const res = await updateGhostViewStyleFor(itemId, imagePath, {
        mirror: typeof patch.mirror === "boolean" ? patch.mirror : !!next?.mirror,
        thumbZoom: typeof patch.thumbZoom === "number" ? patch.thumbZoom : next?.thumbZoom ?? 1,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function patchOriginalStyle(patch: GhostViewStyle) {
    setOriginalStyle((prev) => ({
      mirror: typeof patch.mirror === "boolean" ? patch.mirror : prev.mirror,
      thumbZoom: typeof patch.thumbZoom === "number" ? patch.thumbZoom : prev.thumbZoom,
    }));
    startTransition(async () => {
      const res = await updateOriginalStyleFor(itemId, patch);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function removeView(imagePath: string) {
    startTransition(async () => {
      const res = await deleteGhostViewFor(itemId, imagePath);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setGhostViews((prev) => prev.filter((v) => v.imagePath !== imagePath));
      setPrimaryPath(res.nextPrimary);
      setActiveIndex("original");
      router.refresh();
    });
  }

  const hasGhosts = ghostViews.length > 0;

  return (
    <div className="space-y-3">
      {/* Main image */}
      <div className="rounded-2xl overflow-hidden aspect-square shadow-tile bg-neutral-100 ring-1 ring-inset ring-black/[0.05]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeSrc}
          alt={activeAlt}
          className="w-full h-full object-cover"
          style={activeTransform ? { transform: activeTransform } : undefined}
        />
      </div>

      {/* Thumbnail row */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <ViewThumb
          src={imageUrl(origPath)}
          label="Original"
          mirror={originalStyle.mirror}
          thumbZoom={originalStyle.thumbZoom}
          active={activeIndex === "original"}
          isPrimary={primaryPath === null}
          onClick={() => setActiveIndex("original")}
        />
        {ghostViews.map((view, i) => (
          <div key={view.imagePath} className="relative group">
            <ViewThumb
              src={imageUrl(view.imagePath)}
              label={view.label}
              mirror={!!view.mirror}
              thumbZoom={view.thumbZoom ?? 1}
              active={activeIndex === i}
              onClick={() => setActiveIndex(i)}
              isPrimary={primaryPath === view.imagePath}
            />
            <button
              type="button"
              onClick={() => removeView(view.imagePath)}
              aria-label={`Delete ${view.label}`}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition border border-ink/10"
            >
              ×
            </button>
          </div>
        ))}
        {ghostGenerating && (
          <div className="flex-shrink-0 w-16 flex flex-col items-center gap-1 rounded-xl border border-ink/10 p-1 animate-pulse">
            <div className="w-full aspect-square rounded bg-paper-warm" />
            <span className="text-[9px] text-ink-muted">…</span>
          </div>
        )}
      </div>

      {/* Generate button */}
      {!pickingImages && (
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
            {noCredits ? (
              "Out of credits — buy more in Settings."
            ) : (
              <>
                <span className="inline-flex items-center gap-1">
                  Costs 1 credit (you have
                  <CreditMark className="h-3 w-3 shrink-0" title="Credits" />
                  {credits}).
                </span>
                {sourceImagePaths.length > 0
                  ? " You can select which source images to use."
                  : ""}
              </>
            )}
          </p>
          {ghostGenerating && (
            <p className="text-[11px] text-ink-muted">
              Generating in the background — you can leave this page; refresh later to see the new
              view.
            </p>
          )}
          <button
            type="button"
            onClick={requestGenerate}
            disabled={ghostGenerating || noCredits}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {ghostGenerating
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
      {/* Modal popup for generating a new view */}
      {pickingImages && (
        <GenerateViewModal
          variant={hasGhosts ? "another" : "first"}
          originalPath={origPath}
          extraImagePaths={sourceImagePaths}
          pickState={pickingImages}
          generating={ghostGenerating}
          onChange={setPickingImages}
          onPasteImage={(file) => void addSourceImage(file)}
          onGenerate={() => pickingImages && doGenerate(pickingImages)}
          onCancel={dismissGenerateModal}
        />
      )}
      {whitening && (
        <OriginalWhitenModal
          src={imageUrl(origPath)}
          onClose={() => setWhitening(false)}
          onSave={async (blob) => {
            const formData = new FormData();
            formData.append("image", new File([blob], "cleaned.jpg", { type: "image/jpeg" }));
            const res = await replaceOriginalImageWithEdit(itemId, formData);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setOrigPath(res.imagePath);
            setActiveIndex("original");
            setWhitening(false);
            router.refresh();
          }}
        />
      )}
      {croppingOriginal && (
        <OriginalCropModal
          src={imageUrl(origPath)}
          onClose={() => setCroppingOriginal(false)}
          onConfirm={async (blob) => {
            const formData = new FormData();
            formData.append("image", new File([blob], "crop.jpg", { type: "image/jpeg" }));
            const res = await replaceOriginalImageWithEdit(itemId, formData);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            startTransition(() => {
              setOrigPath(res.imagePath);
              setActiveIndex("original");
              router.refresh();
            });
            setCroppingOriginal(false);
          }}
        />
      )}
      {croppingPath && (
        <GhostViewCropModal
          itemId={itemId}
          imagePath={croppingPath}
          onClose={() => setCroppingPath(null)}
          onReplaced={(previousPath, newPath) => {
            setGhostViews((prev) =>
              prev.map((v) => (v.imagePath === previousPath ? { ...v, imagePath: newPath } : v)),
            );
            setPrimaryPath((p) => (p === previousPath ? newPath : p));
          }}
          onError={setError}
          onRefresh={() => router.refresh()}
        />
      )}
      {!activeGhost && (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Original photo framing</p>
          <p className="text-[11px] text-ink-muted">
            Zoom adjusts how the original is framed in square tiles. Use Crop to reframe the file
            itself (same tool as when you add a piece).
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPrimary(null)}
              className={`rounded-full px-3 py-1 text-xs border ${
                primaryPath === null
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 hover:border-ink/30"
              }`}
            >
              {primaryPath === null ? "Primary thumbnail" : "Set as thumbnail"}
            </button>
            <button
              type="button"
              onClick={() => setCroppingOriginal(true)}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper transition"
            >
              Crop image…
            </button>
            <button
              type="button"
              onClick={() => setWhitening(true)}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper transition"
            >
              Whiten background…
            </button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={originalStyle.mirror}
                onChange={(e) => patchOriginalStyle({ mirror: e.target.checked })}
                className="accent-ink"
              />
              Mirror
            </label>
            <button
              type="button"
              onClick={() => patchOriginalStyle({ thumbZoom: 1 })}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper transition"
            >
              Reset zoom
            </button>
          </div>
          <label className="block text-xs">
            <span className="text-ink-muted">Zoom ({originalStyle.thumbZoom.toFixed(2)}×)</span>
            <input
              type="range"
              min={0.6}
              max={2.4}
              step={0.05}
              value={originalStyle.thumbZoom}
              onChange={(e) => patchOriginalStyle({ thumbZoom: Number(e.target.value) })}
              className="w-full accent-ink"
            />
          </label>
        </div>
      )}
      {activeGhost && (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Selected view controls</p>
          <p className="text-[11px] text-ink-muted">
            Zoom adjusts how this image is framed in square tiles. Use Crop to reframe the file
            itself (same tool as when you add a piece).
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPrimary(activeGhost.imagePath)}
              className={`rounded-full px-3 py-1 text-xs border ${
                primaryPath === activeGhost.imagePath
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 hover:border-ink/30"
              }`}
            >
              {primaryPath === activeGhost.imagePath ? "Primary thumbnail" : "Set as thumbnail"}
            </button>
            <button
              type="button"
              onClick={() => setCroppingPath(activeGhost.imagePath)}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper transition"
            >
              Crop image…
            </button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!activeGhost.mirror}
                onChange={(e) => patchStyle(activeGhost.imagePath, { mirror: e.target.checked })}
                className="accent-ink"
              />
              Mirror
            </label>
            <button
              type="button"
              onClick={() => patchStyle(activeGhost.imagePath, { thumbZoom: 1 })}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper transition"
            >
              Reset zoom
            </button>
          </div>
          <label className="block text-xs">
            <span className="text-ink-muted">Thumbnail zoom ({(activeGhost.thumbZoom ?? 1).toFixed(2)}×)</span>
            <input
              type="range"
              min={0.6}
              max={2.4}
              step={0.05}
              value={activeGhost.thumbZoom ?? 1}
              onChange={(e) => patchStyle(activeGhost.imagePath, { thumbZoom: Number(e.target.value) })}
              className="w-full accent-ink"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function OriginalWhitenModal({
  src,
  onClose,
  onSave,
}: {
  src: string;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-ink/10 bg-white shadow-tile p-4 space-y-3 my-8">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl tracking-tight">Whiten background</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full border border-ink/15 text-sm hover:bg-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <BackgroundWhitener src={src} onCancel={onClose} onSave={onSave} />
      </div>
    </div>
  );
}

function OriginalCropModal({
  src,
  onClose,
  onConfirm,
}: {
  src: string;
  onClose: () => void;
  onConfirm: (blob: Blob) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-ink/10 bg-white shadow-tile p-4 space-y-3 my-8">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl tracking-tight">Crop original photo</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full border border-ink/15 text-sm hover:bg-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          Same controls as when adding a piece: drag to reposition, zoom slider, optional native
          aspect. Square crop matches closet tiles.
        </p>
        <ImageCropper src={src} aspect={1} onCancel={onClose} onConfirm={onConfirm} />
      </div>
    </div>
  );
}

function GhostViewCropModal({
  itemId,
  imagePath,
  onClose,
  onReplaced,
  onError,
  onRefresh,
}: {
  itemId: string;
  imagePath: string;
  onClose: () => void;
  onReplaced: (previousPath: string, newPath: string) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-ink/10 bg-white shadow-tile p-4 space-y-3 my-8">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl tracking-tight">Crop this view</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full border border-ink/15 text-sm hover:bg-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          Same controls as when adding a piece: drag to reposition, zoom slider, optional native
          aspect. Square crop matches closet tiles.
        </p>
        <ImageCropper
          src={imageUrl(imagePath)}
          aspect={1}
          onCancel={onClose}
          onConfirm={async (blob) => {
            const formData = new FormData();
            formData.append("image", new File([blob], "crop.jpg", { type: "image/jpeg" }));
            const res = await replaceGhostViewImageWithCrop(itemId, imagePath, formData);
            if (!res.ok) {
              onError(res.error);
              return;
            }
            startTransition(() => {
              onReplaced(imagePath, res.imagePath);
              onRefresh();
            });
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function ViewThumb({
  src,
  label,
  mirror,
  thumbZoom,
  active,
  isPrimary,
  onClick,
}: {
  src: string;
  label: string;
  mirror?: boolean;
  thumbZoom?: number;
  active: boolean;
  isPrimary?: boolean;
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
      <div className="w-full aspect-square rounded overflow-hidden bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="w-full h-full object-cover"
          style={{ transform: `scale(${thumbZoom ?? 1}) ${mirror ? "scaleX(-1)" : ""}` }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-ink-muted truncate w-full text-center px-0.5">
        {label}
      </span>
      {isPrimary && (
        <span className="text-[8px] uppercase tracking-wide text-ink-muted">Primary</span>
      )}
    </button>
  );
}

function GenerateViewModal({
  variant,
  originalPath,
  extraImagePaths,
  pickState,
  generating,
  onChange,
  onPasteImage,
  onGenerate,
  onCancel,
}: {
  variant: "first" | "another";
  originalPath: string;
  extraImagePaths: string[];
  pickState: PickImageState;
  generating: boolean;
  onChange: (s: PickImageState) => void;
  onPasteImage: (file: File) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const title =
    variant === "another" ? "Generate another view" : "Generate ghost mannequin";
  const canGenerate = pickState.label.trim().length > 0;

  const toggleExtra = (path: string) => {
    const sel = pickState.selectedExtraPaths;
    const wasSelected = sel.includes(path);
    const selectedExtraPaths = wasSelected ? sel.filter((p) => p !== path) : [...sel, path];
    const primaryPath =
      wasSelected && pickState.primaryPath === path ? null : pickState.primaryPath;
    onChange({
      ...pickState,
      selectedExtraPaths,
      primaryPath,
    });
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      e.preventDefault();
      onPasteImage(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPasteImage]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-white shadow-tile p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded-full border border-ink/15 text-sm hover:bg-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          Name this view (required). The <span className="font-medium">first image</span> the model
          sees drives pose — upload a separate back photo, select it below, choose &quot;Back / rear
          catalog&quot;, then generate.
        </p>
        <p className="text-[11px] text-ink-muted">Paste an image to add it as an extra source.</p>

        <p className="text-[10px] uppercase tracking-wide text-ink-muted">Main photo for this render</p>
        <select
          value={pickState.primaryPath ?? "__original__"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__original__") {
              onChange({ ...pickState, primaryPath: null });
              return;
            }
            const nextSel = pickState.selectedExtraPaths.includes(v)
              ? pickState.selectedExtraPaths
              : [...pickState.selectedExtraPaths, v];
            onChange({ ...pickState, primaryPath: v, selectedExtraPaths: nextSel });
          }}
          className="w-full text-xs rounded-lg border border-ink/15 px-3 py-2 bg-paper focus:outline-none focus:border-ink/40"
        >
          <option value="__original__">Original photo</option>
          {extraImagePaths.map((path, i) => (
            <option key={path} value={path}>
              Extra source {i + 1}
            </option>
          ))}
        </select>

        <fieldset className="space-y-1.5 border-0 p-0 m-0">
          <legend className="text-[10px] uppercase tracking-wide text-ink-muted">Catalog angle</legend>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="composition"
              checked={pickState.compositionHint === "default"}
              onChange={() => onChange({ ...pickState, compositionHint: "default" })}
              className="accent-ink"
            />
            Front (default)
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="composition"
              checked={pickState.compositionHint === "rear"}
              onChange={() => onChange({ ...pickState, compositionHint: "rear" })}
              className="accent-ink"
            />
            Back / rear catalog
          </label>
        </fieldset>

        {/* Original — context when another image is primary */}
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
          <span className="text-xs text-ink-muted">
            Listing photo{pickState.primaryPath ? " (included as context)" : " (main input)"}
          </span>
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

        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
          <input
            type="text"
            placeholder="e.g. Front flat lay, Back with collar…"
            value={pickState.label}
            onChange={(e) => onChange({ ...pickState, label: e.target.value })}
            className="w-full text-xs rounded-lg border border-ink/15 px-3 py-1.5 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">
            Instructions for the model (optional)
          </span>
          <textarea
            placeholder="Context or directions for this render…"
            value={pickState.instructions}
            onChange={(e) => onChange({ ...pickState, instructions: e.target.value })}
            rows={3}
            className="w-full text-xs rounded-lg border border-ink/15 px-3 py-2 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40 resize-none min-h-[4rem]"
          />
        </label>

        {generating && (
          <p className="text-[11px] text-ink-muted">
            You can close this dialog or leave the item — generation continues in the background.
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || !canGenerate}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper transition"
          >
            {generating ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
