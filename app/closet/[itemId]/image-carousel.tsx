"use client";

import { useEffect, useRef, useState, useTransition, startTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import {
  deleteGhostViewFor,
  addExtraSourceImageFor,
  addManualGhostViewFor,
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
import { ImageCropper } from "@/components/image-cropper";
import { BackgroundWhitener } from "@/components/background-whitener";
import { Check, Edit, Mirror as MirrorIcon, Refresh, Sparkle, Upload } from "@/components/icons";
import { Button } from "@/components/ui-button";
import { BUTTON_ICON_SIZE } from "@/lib/ui-button-tokens";

const ICON = BUTTON_ICON_SIZE.md;
const ICON_SM = BUTTON_ICON_SIZE.sm;

type GhostView = { label: string; imagePath: string; mirror?: boolean; thumbZoom?: number };
type PickImageState = {
  selectedExtraPaths: string[];
  label: string;
  instructions: string;
  /** `null` = listing photo is the model's first input */
  primaryPath: string | null;
  compositionHint: "default" | "rear";
  /** Which entry point opened the dialog — decides what starts expanded. */
  mode: "upload" | "ai";
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
  /** Non-null when the item's type can't be classified, so AI is unavailable. */
  categoryBlocked?: string | null;
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
  categoryBlocked = null,
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
  const [manualAdding, setManualAdding] = useState(false);
  const [, startTransition] = useTransition();
  const pollGenRef = useRef(0);
  const prevGhostCountRef = useRef(initialGhostViews.length);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickingImages, setPickingImages] = useState<PickImageState | null>(null);
  const [croppingPath, setCroppingPath] = useState<string | null>(null);
  const [whiteningPath, setWhiteningPath] = useState<string | null>(null);
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

  function openViewDialog(mode: "upload" | "ai") {
    setError(null);
    setNotice(null);
    setPickingImages({
      selectedExtraPaths: [...sourceImagePaths],
      label: ghostViews.length > 0 ? `View ${ghostViews.length + 1}` : "Front",
      instructions: "",
      primaryPath: null,
      compositionHint: "default",
      mode,
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

  async function addManualView(file: File) {
    setError(null);
    setManualAdding(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const label = pickingImages?.label.trim() ?? "";
      if (label) formData.append("label", label);
      const res = await addManualGhostViewFor(itemId, formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setGhostViews((prev) => {
        const next = [
          ...prev,
          { label: res.label, imagePath: res.imagePath, mirror: false, thumbZoom: 1 },
        ];
        setActiveIndex(next.length - 1);
        return next;
      });
      setPickingImages(null);
      router.refresh();
    } finally {
      setManualAdding(false);
    }
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
        // creditsUsed === 0 means an identical request already had an image on
        // disk. Say so — otherwise reusing it looks like the generator ignoring
        // the request and returning the same picture.
        if (status.creditsUsed === 0) {
          setNotice(
            "That request was identical to an earlier one, so the existing render was reused — no credit spent. " +
              "Change the instructions to get a different image.",
          );
        }
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

      {/* Add / generate view */}
      {!pickingImages && (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-xs">
            <span className="font-medium">Catalog views</span>{" "}
            {hasGhosts ? `· ${ghostViews.length}` : "— none yet."}
          </p>
          <p className="text-[11px] text-ink-muted">
            Paste or upload a photo to add a view for free, or generate one with AI
            {noCredits ? " (out of credits — buy more in Settings)." : " (1 credit)."}
          </p>
          {ghostGenerating && (
            <p className="text-[11px] text-ink-muted">
              Generating in the background — you can leave this page; refresh later to see the new
              view.
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="solid"
              onClick={() => openViewDialog("upload")}
              disabled={ghostGenerating || manualAdding}
              icon={<Upload size={ICON} />}
            >
              {hasGhosts ? "Add another view" : "Add catalog view"}
            </Button>
            <Button
              onClick={() => openViewDialog("ai")}
              disabled={ghostGenerating || manualAdding || noCredits || !!categoryBlocked}
              title={
                categoryBlocked ?? (noCredits ? "Out of credits — buy more in Settings" : undefined)
              }
              icon={<Sparkle size={ICON} />}
            >
              {ghostGenerating ? "Generating…" : "Generate with AI"}
            </Button>
          </div>
          {categoryBlocked && (
            <p className="text-[11px] text-amber-700">{categoryBlocked}</p>
          )}
          {notice && <p className="text-[11px] text-ink-muted">{notice}</p>}
          {error && (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
      {/* Modal popup for adding a new view */}
      {pickingImages && (
        <GenerateViewModal
          variant={hasGhosts ? "another" : "first"}
          originalPath={origPath}
          extraImagePaths={sourceImagePaths}
          pickState={pickingImages}
          generating={ghostGenerating}
          manualAdding={manualAdding}
          canGenerate={!noCredits}
          onChange={setPickingImages}
          onPasteAsView={(file) => void addManualView(file)}
          onPasteAsSource={(file) => void addSourceImage(file)}
          onUploadAsView={(file) => void addManualView(file)}
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
      {whiteningPath && (
        <GhostViewWhitenModal
          src={imageUrl(whiteningPath)}
          onClose={() => setWhiteningPath(null)}
          onSave={async (blob) => {
            const formData = new FormData();
            formData.append("image", new File([blob], "whitened.jpg", { type: "image/jpeg" }));
            const res = await replaceGhostViewImageWithCrop(itemId, whiteningPath, formData);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            const newPath = res.imagePath;
            startTransition(() => {
              setGhostViews((prev) =>
                prev.map((v) => (v.imagePath === whiteningPath ? { ...v, imagePath: newPath } : v)),
              );
              setPrimaryPath((p) => (p === whiteningPath ? newPath : p));
              router.refresh();
            });
            setWhiteningPath(null);
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
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              title="Use as thumbnail"
              aria-label="Use as thumbnail"
              variant={primaryPath === null ? "solid" : "outline"}
              aria-pressed={primaryPath === null}
              onClick={() => setPrimary(null)}
              icon={<Check size={ICON_SM} />}
            >
              Thumbnail
            </Button>
            <Button
              size="sm"
              title="Crop image"
              aria-label="Crop image"
              onClick={() => setCroppingOriginal(true)}
              icon={<Edit size={ICON_SM} />}
            >
              Crop
            </Button>
            <Button
              size="sm"
              title="Whiten background"
              aria-label="Whiten background"
              onClick={() => setWhitening(true)}
              icon={<Sparkle size={ICON_SM} />}
            >
              Whiten
            </Button>
            {/* A toggle, not a checkbox: the pressed state carries the meaning. */}
            <Button
              size="sm"
              title="Flip horizontally"
              aria-label="Flip horizontally"
              variant={originalStyle.mirror ? "solid" : "outline"}
              aria-pressed={Boolean(originalStyle.mirror)}
              onClick={() => patchOriginalStyle({ mirror: !originalStyle.mirror })}
              icon={<MirrorIcon size={ICON_SM} />}
            >
              Flip
            </Button>
            <Button
              size="sm"
              variant="quiet"
              title="Reset zoom"
              aria-label="Reset zoom"
              onClick={() => patchOriginalStyle({ thumbZoom: 1 })}
              icon={<Refresh size={ICON_SM} />}
            >
              Reset
            </Button>
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
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              title="Use as thumbnail"
              aria-label="Use as thumbnail"
              variant={primaryPath === activeGhost.imagePath ? "solid" : "outline"}
              aria-pressed={primaryPath === activeGhost.imagePath}
              onClick={() => setPrimary(activeGhost.imagePath)}
              icon={<Check size={ICON_SM} />}
            >
              Thumbnail
            </Button>
            <Button
              size="sm"
              title="Crop image"
              aria-label="Crop image"
              onClick={() => setCroppingPath(activeGhost.imagePath)}
              icon={<Edit size={ICON_SM} />}
            >
              Crop
            </Button>
            <Button
              size="sm"
              title="Whiten background"
              aria-label="Whiten background"
              onClick={() => setWhiteningPath(activeGhost.imagePath)}
              icon={<Sparkle size={ICON_SM} />}
            >
              Whiten
            </Button>
            {/* A toggle, not a checkbox: the pressed state carries the meaning. */}
            <Button
              size="sm"
              title="Flip horizontally"
              aria-label="Flip horizontally"
              variant={activeGhost.mirror ? "solid" : "outline"}
              aria-pressed={Boolean(activeGhost.mirror)}
              onClick={() => patchStyle(activeGhost.imagePath, { mirror: !activeGhost.mirror })}
              icon={<MirrorIcon size={ICON_SM} />}
            >
              Flip
            </Button>
            <Button
              size="sm"
              variant="quiet"
              title="Reset zoom"
              aria-label="Reset zoom"
              onClick={() => patchStyle(activeGhost.imagePath, { thumbZoom: 1 })}
              icon={<Refresh size={ICON_SM} />}
            >
              Reset
            </Button>
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

function GhostViewWhitenModal({
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
        <p className="text-xs text-ink-muted">
          Cleans up any off-white cast the render left behind, so the view sits on true #ffffff.
        </p>
        <BackgroundWhitener src={src} onCancel={onClose} onSave={onSave} />
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
  manualAdding,
  canGenerate,
  onChange,
  onPasteAsView,
  onPasteAsSource,
  onUploadAsView,
  onGenerate,
  onCancel,
}: {
  variant: "first" | "another";
  originalPath: string;
  extraImagePaths: string[];
  pickState: PickImageState;
  generating: boolean;
  manualAdding: boolean;
  canGenerate: boolean;
  onChange: (s: PickImageState) => void;
  onPasteAsView: (file: File) => void;
  onPasteAsSource: (file: File) => void;
  onUploadAsView: (file: File) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const aiFirst = pickState.mode === "ai";
  const title = aiFirst
    ? "Generate with AI"
    : variant === "another"
      ? "Add another view"
      : "Add catalog view";
  const busy = generating || manualAdding;
  const canAiGenerate = canGenerate && pickState.label.trim().length > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const onPaste = (e: globalThis.ClipboardEvent) => {
      if (busy) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      e.preventDefault();
      // Default: paste becomes a catalog view directly (no AI).
      // Shift+paste still adds as an AI context source.
      const shiftHeld = Boolean((e as unknown as { shiftKey?: boolean }).shiftKey);
      if (shiftHeld) onPasteAsSource(file);
      else onPasteAsView(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, onPasteAsView, onPasteAsSource]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-white shadow-tile p-4 flex flex-col gap-3">
        <div className="order-1 flex items-center justify-between">
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

        <div
          className={`${aiFirst ? "order-3" : "order-2"} rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2`}
        >
          <p className="text-xs font-medium">
            {aiFirst ? "Name this view" : "Paste or upload a photo"}
          </p>
          <p className="text-[11px] text-ink-muted">
            {aiFirst
              ? "The AI render needs a name. You can also paste or upload a photo instead — that adds a view immediately, no credit."
              : "Adds the image as a catalog view immediately — no AI, no credit. Optional: name it below first. Shift+paste adds it as an AI context source instead."}
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
            <input
              type="text"
              placeholder="e.g. Back, Detail, Flat lay…"
              value={pickState.label}
              onChange={(e) => onChange({ ...pickState, label: e.target.value })}
              disabled={busy}
              className="w-full text-xs rounded-lg border border-ink/15 px-3 py-1.5 bg-white placeholder:text-ink-muted focus:outline-none focus:border-ink/40 disabled:opacity-50"
            />
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUploadAsView(file);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {manualAdding ? "Adding…" : "Upload photo as view"}
          </button>
        </div>

        <details
          open={aiFirst}
          className={`${aiFirst ? "order-2" : "order-3"} rounded-xl border border-ink/10 p-3 group`}
        >
          <summary className="text-xs font-medium cursor-pointer list-none flex items-center justify-between">
            <span>{aiFirst ? "Render settings" : "Or generate with AI"}</span>
            <span className="text-[10px] text-ink-muted group-open:hidden">1 credit</span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-ink-muted">
              The <span className="font-medium">first image</span> the model sees drives pose —
              upload a separate back photo (Shift+paste), select it below, choose &quot;Back / rear
              catalog&quot;, then generate.
            </p>

            <p className="text-[10px] uppercase tracking-wide text-ink-muted">
              Main photo for this render
            </p>
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
              <legend className="text-[10px] uppercase tracking-wide text-ink-muted">
                Catalog angle
              </legend>
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
                You can close this dialog or leave the item — generation continues in the
                background.
              </p>
            )}
            {!canGenerate && (
              <p className="text-[11px] text-ink-muted">Out of credits for AI generation.</p>
            )}
            <button
              type="button"
              onClick={onGenerate}
              disabled={busy || !canAiGenerate}
              className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate with AI"}
            </button>
          </div>
        </details>

        <button
          type="button"
          onClick={onCancel}
          className="order-4 self-start rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper transition"
        >
          {busy ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
