"use client";

import { useEffect, useRef, useState, useTransition, startTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import {
  deleteGhostViewFor,
  deleteOriginalPhotoFor,
  addExtraSourceImageFor,
  addManualGhostViewFor,
  addWebProductGhostViewFor,
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
import { PhotoSourcePicker } from "@/components/photo-source-picker";
import { WebcamCaptureModal } from "@/components/webcam-capture-modal";
import { searchWebProductsAction } from "@/app/closet/add/actions";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import { BackgroundWhitener } from "@/components/background-whitener";
import { Check, Edit, Mirror as MirrorIcon, Refresh, Sparkle, Upload } from "@/components/icons";
import { Button } from "@/components/ui-button";
import { BUTTON_ICON_SIZE } from "@/lib/ui-button-tokens";

const ICON = BUTTON_ICON_SIZE.md;
const ICON_SM = BUTTON_ICON_SIZE.sm;

type GhostView = { label: string; imagePath: string; mirror?: boolean; thumbZoom?: number };
/**
 * The "Add another picture" dialog's only state: what to call the picture.
 *
 * Used to also carry the AI render's context-image selection, primary-source
 * override and front/back hint, because one modal served both "add a picture"
 * and "generate with AI". Generating is now a single button press
 * (`doGenerate`), so those fields have no UI and no reader.
 */
type AddPictureDraft = {
  label: string;
};

/** Options applied to the next render, from the button's ⋮ menu. */
type GenerateOptions = {
  /** View name. Blank falls back to "Ghost"/"View n" server-side. */
  label: string;
  /** Extra directions passed to the model. */
  instructions: string;
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
  /** Per-generation money cost, e.g. "$0.067" or "free in stub mode". */
  costLabel: string;
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
  costLabel,
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
  const [addingPicture, setAddingPicture] = useState<AddPictureDraft | null>(null);
  /*
   * Held on the page, not in a dialog. Generation is one click now; these are
   * the two things worth being able to set before that click, and they persist
   * across renders so a prompt you tuned once survives the next generate.
   */
  const [genOptions, setGenOptions] = useState<GenerateOptions>({ label: "", instructions: "" });
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [croppingPath, setCroppingPath] = useState<string | null>(null);
  const [whiteningPath, setWhiteningPath] = useState<string | null>(null);
  const [croppingOriginal, setCroppingOriginal] = useState(false);
  /*
   * Camera and web-search state for the "Add another picture" chooser.
   *
   * Held here rather than in the modal because the camera modal has to render
   * *outside* the dialog (a modal inside a modal cannot sit above it), and
   * because search results should survive closing and reopening the dialog —
   * every re-search is a billed SerpAPI call.
   */
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webQuery, setWebQuery] = useState("");
  const [webResults, setWebResults] = useState<ProductMatch[]>([]);
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

  function openAddPictureDialog() {
    setError(null);
    setNotice(null);
    setAddingPicture({
      label: ghostViews.length > 0 ? `View ${ghostViews.length + 1}` : "Front",
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
    router.refresh();
  }

  async function runWebSearch(query: string): Promise<ProductMatch[]> {
    const res = await searchWebProductsAction(query);
    if (!res.ok) throw new Error(res.error);
    return res.matches;
  }

  /** Import a listing photo as another view. Never touches the item's fields. */
  async function addWebView(match: ProductMatch) {
    setError(null);
    setManualAdding(true);
    try {
      const label = addingPicture?.label.trim() || undefined;
      const res = await addWebProductGhostViewFor(itemId, match, label);
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
      setAddingPicture(null);
      router.refresh();
    } finally {
      setManualAdding(false);
    }
  }

  async function addManualView(file: File) {
    setError(null);
    setManualAdding(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const label = addingPicture?.label.trim() ?? "";
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
      setAddingPicture(null);
      router.refresh();
    } finally {
      setManualAdding(false);
    }
  }

  function dismissAddPictureDialog() {
    setAddingPicture(null);
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

  /**
   * Generate, immediately.
   *
   * No dialog. What the removed one asked for is either already known or has a
   * default worth keeping: every context image is passed (which is what the old
   * checkboxes defaulted to), the render starts from the thumbnail rather than
   * an overridable "main photo" (see runGenerateGhostViewFor), and the front
   * angle is the default. Name and instructions come from the ⋮ menu.
   */
  function doGenerate() {
    setError(null);
    setNotice(null);
    setGenMenuOpen(false);
    setGhostGenerating(true);
    void enqueueGhostViewFor(
      itemId,
      sourceImagePaths,
      genOptions.label,
      genOptions.instructions,
      null,
      "default",
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

  /**
   * Delete the original photo.
   *
   * Only offered once another picture exists: the server promotes the thumbnail
   * into the original's place (see deleteOriginalPhotoFor) because an item
   * cannot have no photo, so with nothing to promote there is nothing to do.
   */
  function deleteOriginal() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteOriginalPhotoFor(itemId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The promoted image stops being a view and becomes the original, and the
      // original is the thumbnail again — mirror both locally so the strip does
      // not show it twice before the refresh lands.
      setGhostViews((prev) => prev.filter((v) => v.imagePath !== res.originalImagePath));
      setOrigPath(res.originalImagePath);
      setPrimaryPath(null);
      setActiveIndex("original");
      setNotice(`Original deleted — "${res.promotedFrom}" is the item's photo now.`);
      router.refresh();
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
        {/*
          The original gets the same corner × as every other tile. It used to be
          a Delete button buried in the framing controls below, which meant the
          one photo you cannot reach by hovering its own thumbnail was the one
          whose delete lived somewhere else.

          Only once there is something to promote into its place — see
          deleteOriginalPhotoFor. With nothing to promote the × is absent rather
          than disabled, matching how the button behaved.
        */}
        <div className="relative group">
          <ViewThumb
            src={imageUrl(origPath)}
            label="Original"
            mirror={originalStyle.mirror}
            thumbZoom={originalStyle.thumbZoom}
            active={activeIndex === "original"}
            isPrimary={primaryPath === null}
            onClick={() => setActiveIndex("original")}
          />
          {hasGhosts && (
            <button
              type="button"
              onClick={deleteOriginal}
              aria-label="Delete original photo"
              title="Delete the original — the thumbnail takes its place"
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-surface/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition border border-ink/10"
            >
              ×
            </button>
          )}
        </div>
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
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-surface/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition border border-ink/10"
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
      {!addingPicture && (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-xs">
            <span className="font-medium">Catalog views</span>{" "}
            {hasGhosts ? `· ${ghostViews.length}` : "— none yet."}
          </p>
          <p className="text-[11px] text-ink-muted">
            Adding a picture is free. Generating renders from whichever image is set as the
            thumbnail
            {noCredits
              ? " (out of credits — buy more in Settings)."
              : ` (1 credit · ${costLabel}).`}
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
              onClick={openAddPictureDialog}
              disabled={ghostGenerating || manualAdding}
              icon={<Upload size={ICON} />}
            >
              Add another picture
            </Button>

            {/*
              A split button: the label generates, the ⋮ opens the two settings
              worth having. Pressing this used to open a dialog whose only
              required field was a name, so the common case — "render this
              again" — cost two clicks and a form.
            */}
            <div className="relative inline-flex items-stretch">
              <Button
                onClick={doGenerate}
                disabled={ghostGenerating || manualAdding || noCredits || !!categoryBlocked}
                title={
                  categoryBlocked ??
                  (noCredits ? "Out of credits — buy more in Settings" : "Render from the thumbnail")
                }
                icon={<Sparkle size={ICON} />}
                className="rounded-r-none border-r-0 pr-3"
              >
                {ghostGenerating ? "Generating…" : "Generate with AI"}
              </Button>
              <Button
                iconOnly
                aria-label="Render options"
                aria-expanded={genMenuOpen}
                aria-haspopup="dialog"
                title="Name and prompt for this render"
                onClick={() => setGenMenuOpen((open) => !open)}
                disabled={ghostGenerating || manualAdding}
                /* w-8, not the icon-only square: this is the right end of a
                   button, not a button of its own. */
                className={`w-8 rounded-l-none border-l border-l-ink/20 ${
                  genMenuOpen ? "bg-paper-warm" : ""
                }`}
                icon={<MoreGlyph />}
              />
              {genMenuOpen && (
                <GenerateOptionsMenu
                  options={genOptions}
                  onChange={setGenOptions}
                  onClose={() => setGenMenuOpen(false)}
                />
              )}
            </div>
          </div>
          {(genOptions.label.trim() || genOptions.instructions.trim()) && (
            <p className="text-[11px] text-ink-muted">
              Next render:{" "}
              {[
                genOptions.label.trim() ? `named "${genOptions.label.trim()}"` : null,
                genOptions.instructions.trim() ? "with your prompt" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
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
      {/* Modal popup for adding a new picture */}
      {addingPicture && (
        <AddPictureModal
          draft={addingPicture}
          manualAdding={manualAdding}
          onChange={setAddingPicture}
          onPasteAsView={(file) => void addManualView(file)}
          onPasteAsSource={(file) => void addSourceImage(file)}
          onUploadAsView={(file) => void addManualView(file)}
          onTakePhoto={() => setWebcamOpen(true)}
          webQuery={webQuery}
          onWebQueryChange={setWebQuery}
          webResults={webResults}
          onWebResultsChange={setWebResults}
          onWebSearch={runWebSearch}
          onSelectWebProduct={(m) => void addWebView(m)}
          onCancel={dismissAddPictureDialog}
        />
      )}

      {/* Outside the dialog: a modal nested inside another modal cannot paint
          above it, and the capture has to cover the dialog it was opened from. */}
      <WebcamCaptureModal
        open={webcamOpen}
        preferredFacing="environment"
        title="Take a photo"
        onClose={() => setWebcamOpen(false)}
        onCapture={(file) => {
          setWebcamOpen(false);
          void addManualView(file);
        }}
      />
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
      <div className="w-full max-w-2xl rounded-2xl border border-ink/10 bg-surface shadow-tile p-4 space-y-3 my-8">
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
      <div className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface shadow-tile p-4 space-y-3 my-8">
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
      <div className="w-full max-w-2xl rounded-2xl border border-ink/10 bg-surface shadow-tile p-4 space-y-3 my-8">
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
      <div className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface shadow-tile p-4 space-y-3 my-8">
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
      <div className="w-full aspect-square rounded overflow-hidden bg-surface">
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

/**
 * Add another picture: camera, the web, or a file.
 *
 * Used to be a two-headed dialog that also carried every AI render setting —
 * context-image checkboxes, a "main photo for this render" select, a front/back
 * radio and a prompt box — with the two halves reordered depending on which
 * button opened it. Generating is now one press of the button on the page, so
 * all of that is gone; what remains is one job with one field.
 */
function AddPictureModal({
  draft,
  manualAdding,
  onChange,
  onPasteAsView,
  onPasteAsSource,
  onUploadAsView,
  onTakePhoto,
  webQuery,
  onWebQueryChange,
  webResults,
  onWebResultsChange,
  onWebSearch,
  onSelectWebProduct,
  onCancel,
}: {
  draft: AddPictureDraft;
  manualAdding: boolean;
  onChange: (draft: AddPictureDraft) => void;
  onPasteAsView: (file: File) => void;
  onPasteAsSource: (file: File) => void;
  onUploadAsView: (file: File) => void;
  onTakePhoto: () => void;
  webQuery: string;
  onWebQueryChange: (q: string) => void;
  webResults: ProductMatch[];
  onWebResultsChange: (r: ProductMatch[]) => void;
  onWebSearch: (q: string) => Promise<ProductMatch[]>;
  onSelectWebProduct: (m: ProductMatch) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onPaste = (e: globalThis.ClipboardEvent) => {
      if (manualAdding) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      e.preventDefault();
      // Default: paste becomes a view directly. Shift+paste adds it as an AI
      // context source instead.
      const shiftHeld = Boolean((e as unknown as { shiftKey?: boolean }).shiftKey);
      if (shiftHeld) onPasteAsSource(file);
      else onPasteAsView(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [manualAdding, onPasteAsView, onPasteAsSource]);

  // Escape closes, which a dialog with no other dismissal keyboard path needs.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add another picture"
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-ink/10 bg-surface p-4 shadow-tile"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl tracking-tight">Add another picture</h3>
          <button
            type="button"
            onClick={onCancel}
            className="h-7 w-7 rounded-full border border-ink/15 text-sm hover:bg-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
          <input
            type="text"
            placeholder="e.g. Back, Detail, Flat lay…"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            disabled={manualAdding}
            className="w-full rounded-lg border border-ink/15 bg-surface px-3 py-1.5 text-xs placeholder:text-ink-muted focus:border-ink/40 focus:outline-none disabled:opacity-50"
          />
        </label>

        <PhotoSourcePicker
          compact
          title={manualAdding ? "Adding…" : "Add another picture"}
          subtitle="Drop, paste, snap, or click here"
          disabled={manualAdding}
          onFile={onUploadAsView}
          onTakePhoto={onTakePhoto}
          web={{
            query: webQuery,
            onQueryChange: onWebQueryChange,
            results: webResults,
            onResultsChange: onWebResultsChange,
            onSearch: onWebSearch,
            onSelect: onSelectWebProduct,
            hint: "Picking a result adds its photo as a view. It does not change this item's brand, price, or any other field.",
          }}
        />

        <button
          type="button"
          onClick={onCancel}
          className="self-start rounded-full border border-ink/15 px-4 py-1.5 text-xs transition hover:bg-paper"
        >
          {manualAdding ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

/** Three dots. Local rather than in the icon suite, like MenuGlyph in the nav drawer. */
function MoreGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden focusable="false">
      <g fill="currentColor">
        <circle cx="7" cy="2.5" r="1.35" />
        <circle cx="7" cy="7" r="1.35" />
        <circle cx="7" cy="11.5" r="1.35" />
      </g>
    </svg>
  );
}

/**
 * The two render settings, in a popover on the generate button.
 *
 * Everything else the old dialog asked for now has a fixed answer (see
 * `doGenerate`), so this is a name and a prompt. Both persist on the page, so
 * tuning a prompt once and pressing generate three times works without
 * retyping.
 */
function GenerateOptionsMenu({
  options,
  onChange,
  onClose,
}: {
  options: GenerateOptions;
  onChange: (next: GenerateOptions) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // `mousedown`, not `click`: the button that opened this is outside `ref`, so
    // a click listener would fire on the same event that opened the menu and
    // close it again immediately.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dirty = Boolean(options.label.trim() || options.instructions.trim());

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Render options"
      /* Right-aligned to the ⋮ and above the fold-prone bottom of the panel. */
      className="absolute right-0 top-full z-30 mt-2 w-72 space-y-2.5 rounded-xl border border-ink/15 bg-surface p-3 shadow-tile"
    >
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
        <input
          type="text"
          placeholder="Ghost"
          value={options.label}
          onChange={(e) => onChange({ ...options, label: e.target.value })}
          className="w-full rounded-lg border border-ink/15 bg-surface px-3 py-1.5 text-xs placeholder:text-ink-muted focus:border-ink/40 focus:outline-none"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">
          Prompt (optional)
        </span>
        <textarea
          placeholder="Context or directions for this render…"
          value={options.instructions}
          onChange={(e) => onChange({ ...options, instructions: e.target.value })}
          rows={3}
          className="min-h-[4rem] w-full resize-none rounded-lg border border-ink/15 bg-surface px-3 py-2 text-xs placeholder:text-ink-muted focus:border-ink/40 focus:outline-none"
        />
      </label>

      <p className="text-[11px] text-ink-muted">
        Applies to every render until you change it. Leave the name blank and it&apos;s numbered
        for you.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-ink px-4 py-1.5 text-xs tracking-wide text-paper transition hover:bg-ink-soft"
        >
          Done
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => onChange({ label: "", instructions: "" })}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
