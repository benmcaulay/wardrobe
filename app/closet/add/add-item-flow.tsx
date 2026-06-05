"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import { ProductSearchPanel } from "@/components/product-search-panel";
import { CreditMark } from "@/components/credit-mark";
import { ImageCropper } from "@/components/image-cropper";
import { WebcamCaptureModal } from "@/components/webcam-capture-modal";
import { imageUrl } from "@/lib/image-paths";
import { canonicalCategoryChoice } from "@/lib/categories";
import { previewGhostMannequin } from "@/lib/actions/ghost-mannequin";
import { mapCategoryToGhost } from "@/lib/services/ghost-mannequin-shared";
import type { ItemFormValue } from "@/lib/types";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import {
  analyzeUpload,
  applyProductMatchAction,
  createItem,
  discardUpload,
  discardExtraImage,
  saveExtraImage,
  searchWebProductsAction,
  type AnalyzeUploadResponse,
} from "./actions";

type AnalyzeOk = Extract<AnalyzeUploadResponse, { ok: true }>;

type ExtraImage = { id: string; path: string; previewUrl: string };
type GhostView = {
  id: string;
  label: string;
  imagePath: string;
  creditsUsed: number;
};
type PickImageState = {
  selectedExtraIds: string[];
  label: string;
  instructions: string;
  /** `null` = main listing crop is the model's first input */
  primaryExtraId: string | null;
  compositionHint: "default" | "rear";
};

type ReadyState = {
  kind: "ready";
  previewUrl: string;
  analyze: AnalyzeOk;
  ghostViews: GhostView[];
  activeViewId: string | null; // null = show original
  generatingGhost: boolean;
  ghostError: string | null;
  extras: ExtraImage[];
  value: ItemFormValue;
  pickingImages: PickImageState | null;
};

type FlowState =
  | { kind: "idle"; error?: string }
  | { kind: "cropping"; sourceUrl: string }
  | { kind: "processing"; previewUrl: string }
  | ReadyState
  | { kind: "saving"; previewUrl: string }
  | { kind: "error"; message: string };

type Props = {
  credits: number;
  autoGenerateGhost: boolean;
  categories: string[];
  styleTagsList: string[];
  webMatchAutofill: boolean;
};

function getClipboardImageFile(e: ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items ?? []);
  const item = items.find((i) => i.type.startsWith("image/"));
  return item ? item.getAsFile() : null;
}

/** Matches server `ALLOWED_MIME` (lib/uploads). */
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

function clearFileInputs(...refs: Array<RefObject<HTMLInputElement | null>>) {
  for (const r of refs) {
    if (r.current) r.current.value = "";
  }
}

export function AddItemFlow({
  credits: initialCredits,
  autoGenerateGhost,
  categories,
  styleTagsList,
  webMatchAutofill,
}: Props) {
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const [credits, setCredits] = useState(initialCredits);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [webcam, setWebcam] = useState<null | { facing: "environment" | "user" }>(null);
  const [pendingFormPatch, setPendingFormPatch] = useState<Partial<ItemFormValue> | null>(null);
  const [selectedWebProductUrl, setSelectedWebProductUrl] = useState<string | null>(null);
  const webcamHandlerRef = useRef<(file: File) => void>(() => {});

  function openWebcamCapture(facing: "environment" | "user", onFile: (file: File) => void) {
    webcamHandlerRef.current = onFile;
    setWebcam({ facing });
  }

  const libraryInputRef = useRef<HTMLInputElement>(null);
  const extraInputRef = useRef<HTMLInputElement>(null);

  // Stable ref to current paste handler so we only register one listener
  const pasteHandlerRef = useRef<((e: ClipboardEvent) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
      if (
        state.kind === "processing" ||
        state.kind === "ready" ||
        state.kind === "saving"
      ) {
        URL.revokeObjectURL(state.previewUrl);
      }
      if (state.kind === "ready") {
        for (const e of state.extras) URL.revokeObjectURL(e.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register paste listener once; handler reads the ref so it always sees current state
  useEffect(() => {
    const handler = (e: ClipboardEvent) => pasteHandlerRef.current?.(e);
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);

  function handleFile(file: File) {
    const sourceUrl = URL.createObjectURL(file);
    setState({ kind: "cropping", sourceUrl });
  }

  async function addExtra(file: File) {
    // Capture current state synchronously before the async call
    setState((s) => {
      if (s.kind !== "ready") return s;
      return s; // just validate state, actual update happens after upload
    });
    // Read state directly for the async check
    const previewUrl = URL.createObjectURL(file);
    const formData = new FormData();
    formData.append("image", file);
    const res = await saveExtraImage(formData);
    if (!res.ok) {
      URL.revokeObjectURL(previewUrl);
      console.warn(res.error);
      return;
    }
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            extras: [...s.extras, { id: crypto.randomUUID(), path: res.imagePath, previewUrl }],
          }
        : s,
    );
  }

  // Update paste handler each render so it always captures current state/functions
  pasteHandlerRef.current = (e: ClipboardEvent) => {
    const file = getClipboardImageFile(e);
    if (!file) return;
    if (state.kind === "idle") {
      e.preventDefault();
      handleFile(file);
    } else if (state.kind === "ready" && !state.pickingImages) {
      e.preventDefault();
      void addExtra(file);
    }
  };

  async function onSelectWebProduct(match: ProductMatch) {
    setSelectedWebProductUrl(match.url);
    const res = await applyProductMatchAction(match);
    if (!res.ok) {
      setState((s) => {
        if (s.kind === "idle") return { ...s, error: res.error };
        if (s.kind === "ready") return { ...s, ghostError: res.error };
        return s;
      });
      return;
    }
    setState((s) => {
      if (s.kind === "ready") {
        return { ...s, ghostError: null, value: { ...s.value, ...res.patch } };
      }
      return s;
    });
    setPendingFormPatch((prev) => ({ ...prev, ...res.patch }));
  }

  async function runWebSearch(query: string): Promise<ProductMatch[]> {
    const res = await searchWebProductsAction(query);
    if (!res.ok) throw new Error(res.error);
    return res.matches;
  }

  async function handleCroppedBlob(blob: Blob) {
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);

    const previewUrl = URL.createObjectURL(blob);
    setState({ kind: "processing", previewUrl });

    const file = new File([blob], "garment.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("image", file);
    const analyzeRes = await analyzeUpload(formData);

    if (!analyzeRes.ok) {
      URL.revokeObjectURL(previewUrl);
      setState({ kind: "error", message: analyzeRes.error });
      return;
    }

    const prefill = analyzeRes.bundle.prefill;
    const merged = { ...prefill, ...pendingFormPatch };
    const ready: ReadyState = {
      kind: "ready",
      previewUrl,
      analyze: analyzeRes,
      ghostViews: [],
      activeViewId: null,
      generatingGhost: false,
      ghostError: null,
      extras: [],
      value: {
        name: merged.name ?? "",
        brand: merged.brand ?? "",
        category: canonicalCategoryChoice(merged.category, categories),
        subcategory: merged.subcategory ?? "",
        colors: merged.colors ?? [],
        priceCents: merged.priceCents ?? null,
        currency: merged.currency ?? "USD",
        material: merged.material ?? "",
        pattern: merged.pattern ?? "",
        styleTags: merged.styleTags ?? [],
        season: merged.season ?? [],
        notes: "",
        isWishlist: false,
      },
      pickingImages: null,
    };
    setState(ready);
    setPendingFormPatch(null);

    if (autoGenerateGhost && credits > 0) {
      await runGhost(
        {
          selectedExtraIds: [],
          label: "",
          instructions: "",
          primaryExtraId: null,
          compositionHint: "default",
        },
        ready,
      );
    }
  }

  function cancelCrop() {
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
    setState({ kind: "idle" });
    clearFileInputs(libraryInputRef);
  }

  function patchValue(patch: Partial<ItemFormValue>) {
    setState((s) => (s.kind === "ready" ? { ...s, value: { ...s.value, ...patch } } : s));
  }

  async function runGhost(pick: PickImageState, snapshot?: ReadyState) {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, generatingGhost: true, ghostError: null, pickingImages: null }
        : s,
    );
    const current = snapshot ?? (state.kind === "ready" ? state : null);
    if (!current) return;

    const selectedExtras = current.extras
      .filter((e) => pick.selectedExtraIds.includes(e.id))
      .map((e) => e.path);

    const primaryOverridePath =
      pick.primaryExtraId === null
        ? undefined
        : current.extras.find((e) => e.id === pick.primaryExtraId)?.path;

    const defaultLabel =
      current.ghostViews.length === 0 ? "Ghost" : `View ${current.ghostViews.length + 1}`;
    const viewLabel = pick.label.trim() || defaultLabel;
    const instructionsTrimmed = pick.instructions.trim();

    const res = await previewGhostMannequin({
      garmentImagePath: current.analyze.originalImagePath,
      extraImagePaths: selectedExtras,
      primaryGarmentPathOverride: primaryOverridePath,
      category: mapCategoryToGhost(current.value.category),
      instructions: instructionsTrimmed || undefined,
      compositionHint: pick.compositionHint,
    });

    setState((s) => {
      if (s.kind !== "ready") return s;
      if (!res.ok) return { ...s, generatingGhost: false, ghostError: res.error };
      const newView: GhostView = {
        id: crypto.randomUUID(),
        label: viewLabel,
        imagePath: res.ghostImagePath,
        creditsUsed: res.creditsUsed,
      };
      return {
        ...s,
        generatingGhost: false,
        ghostError: null,
        ghostViews: [...s.ghostViews, newView],
        activeViewId: newView.id,
      };
    });
    if (res.ok) setCredits(res.creditsRemaining);
  }

  function requestGhost() {
    if (state.kind !== "ready") return;
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            pickingImages: {
              selectedExtraIds: s.extras.map((e) => e.id),
              label: "Front",
              instructions: "",
              primaryExtraId: null,
              compositionHint: "default",
            },
          }
        : s,
    );
  }

  async function removeExtra(id: string) {
    if (state.kind !== "ready") return;
    const target = state.extras.find((e) => e.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.previewUrl);
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            extras: s.extras.filter((e) => e.id !== id),
            pickingImages: s.pickingImages
              ? {
                  ...s.pickingImages,
                  selectedExtraIds: s.pickingImages.selectedExtraIds.filter((x) => x !== id),
                  primaryExtraId:
                    s.pickingImages.primaryExtraId === id ? null : s.pickingImages.primaryExtraId,
                }
              : null,
          }
        : s,
    );
    await discardExtraImage(target.path);
  }

  async function removeGhostView(id: string) {
    if (state.kind !== "ready") return;
    const target = state.ghostViews.find((v) => v.id === id);
    if (!target) return;

    setState((s) => {
      if (s.kind !== "ready") return s;
      const remaining = s.ghostViews.filter((v) => v.id !== id);
      const nextActive =
        s.activeViewId === id
          ? remaining.length > 0
            ? remaining[remaining.length - 1]!.id
            : null
          : s.activeViewId;
      return { ...s, ghostViews: remaining, activeViewId: nextActive };
    });
    await discardExtraImage(target.imagePath);
  }

  function onSave() {
    if (state.kind !== "ready") return;
    const snapshot = state;
    setState({ kind: "saving", previewUrl: snapshot.previewUrl });
    startTransition(async () => {
      const primaryGhost = snapshot.ghostViews[0] ?? null;
      const result = await createItem({
        ...snapshot.value,
        originalImagePath: snapshot.analyze.originalImagePath,
        ghostImagePath: primaryGhost?.imagePath ?? null,
        ghostViews: snapshot.ghostViews.map((v) => ({
          label: v.label,
          imagePath: v.imagePath,
          creditsUsed: v.creditsUsed,
        })),
        extraImagePaths: snapshot.extras.map((e) => e.path),
        sourceData: snapshot.analyze.bundle.sourceData,
      });
      if (!result.ok) {
        setState({ kind: "error", message: result.error });
        return;
      }
      router.push(`/closet/${result.itemId}`);
    });
  }

  async function onDiscard() {
    if (state.kind === "ready" || state.kind === "saving") {
      URL.revokeObjectURL(state.previewUrl);
      if (state.kind === "ready") {
        for (const e of state.extras) URL.revokeObjectURL(e.previewUrl);
        await Promise.all([
          discardUpload(state.analyze.originalImagePath),
          ...state.extras.map((e) => discardExtraImage(e.path)),
          ...state.ghostViews.map((v) => discardExtraImage(v.imagePath)),
        ]);
      }
    }
    setState({ kind: "idle" });
    setPendingFormPatch(null);
    setSelectedWebProductUrl(null);
    clearFileInputs(libraryInputRef, extraInputRef);
  }

  return (
    <div className="space-y-8">
      {state.kind === "idle" && (
        <>
          <ProductSearchPanel
            title="Search the web"
            hint={
              webMatchAutofill
                ? "Find a listing first, then add your garment photo. Fields pre-fill when you pick a result."
                : "Optional: search for a listing and pick one to copy details into the form after you add a photo."
            }
            onSearch={runWebSearch}
            onSelect={(m) => void onSelectWebProduct(m)}
            selectedUrl={selectedWebProductUrl}
          />
          <IdleView
            onFile={handleFile}
            libraryInputRef={libraryInputRef}
            onTakePhoto={() => openWebcamCapture("environment", handleFile)}
            error={state.error}
          />
        </>
      )}

      {state.kind === "cropping" && (
        <ImageCropper src={state.sourceUrl} onCancel={cancelCrop} onConfirm={handleCroppedBlob} />
      )}

      {state.kind === "processing" && <ProcessingView previewUrl={state.previewUrl} />}

      {state.kind === "ready" && (
        <ReadyView
          state={state}
          categories={categories}
          styleTagsList={styleTagsList}
          credits={credits}
          extraInputRef={extraInputRef}
          onTakePhotoExtra={() => openWebcamCapture("environment", addExtra)}
          webMatchAutofill={webMatchAutofill}
          onSearchWeb={runWebSearch}
          onSelectWebProduct={(m) => void onSelectWebProduct(m)}
          selectedWebProductUrl={selectedWebProductUrl}
          onChange={patchValue}
          onRequestGhost={requestGhost}
          onConfirmPick={(pick) => void runGhost(pick)}
          onCancelPick={() =>
            setState((s) => (s.kind === "ready" ? { ...s, pickingImages: null } : s))
          }
          onTogglePickExtra={(id) =>
            setState((s) => {
              if (s.kind !== "ready" || !s.pickingImages) return s;
              const sel = s.pickingImages.selectedExtraIds;
              const wasSelected = sel.includes(id);
              const selectedExtraIds = wasSelected ? sel.filter((x) => x !== id) : [...sel, id];
              const primaryExtraId =
                wasSelected && s.pickingImages.primaryExtraId === id
                  ? null
                  : s.pickingImages.primaryExtraId;
              return {
                ...s,
                pickingImages: {
                  ...s.pickingImages,
                  selectedExtraIds,
                  primaryExtraId,
                },
              };
            })
          }
          onPickLabelChange={(label) =>
            setState((s) =>
              s.kind === "ready" && s.pickingImages
                ? { ...s, pickingImages: { ...s.pickingImages, label } }
                : s,
            )
          }
          onPickInstructionsChange={(instructions) =>
            setState((s) =>
              s.kind === "ready" && s.pickingImages
                ? { ...s, pickingImages: { ...s.pickingImages, instructions } }
                : s,
            )
          }
          onPickPrimaryChange={(primaryExtraId) =>
            setState((s) =>
              s.kind === "ready" && s.pickingImages
                ? {
                    ...s,
                    pickingImages: {
                      ...s.pickingImages,
                      primaryExtraId,
                      selectedExtraIds:
                        primaryExtraId !== null &&
                        !s.pickingImages.selectedExtraIds.includes(primaryExtraId)
                          ? [...s.pickingImages.selectedExtraIds, primaryExtraId]
                          : s.pickingImages.selectedExtraIds,
                    },
                  }
                : s,
            )
          }
          onPickCompositionChange={(compositionHint) =>
            setState((s) =>
              s.kind === "ready" && s.pickingImages
                ? { ...s, pickingImages: { ...s.pickingImages, compositionHint } }
                : s,
            )
          }
          onActivateView={(id) =>
            setState((s) => (s.kind === "ready" ? { ...s, activeViewId: id } : s))
          }
          onRemoveGhostView={(id) => void removeGhostView(id)}
          onAddExtra={addExtra}
          onRemoveExtra={removeExtra}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}

      {state.kind === "saving" && <SavingView previewUrl={state.previewUrl} />}

      {state.kind === "error" && (
        <div className="space-y-4">
          <p
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
          >
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => setState({ kind: "idle" })}
            className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Try again
          </button>
        </div>
      )}

      <WebcamCaptureModal
        open={webcam !== null}
        preferredFacing={webcam?.facing ?? "environment"}
        title="Take a photo"
        onClose={() => setWebcam(null)}
        onCapture={(file) => webcamHandlerRef.current(file)}
      />
    </div>
  );
}

function IdleView({
  onFile,
  libraryInputRef,
  onTakePhoto,
  error,
}: {
  onFile: (f: File) => void;
  libraryInputRef: RefObject<HTMLInputElement | null>;
  onTakePhoto: () => void;
  error?: string;
}) {
  const [dragActive, setDragActive] = useState(false);

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={`rounded-3xl border-2 border-dashed p-12 text-center transition ${
          dragActive ? "border-accent bg-accent-soft/20" : "border-ink/15 bg-paper-warm"
        }`}
      >
        <p className="font-serif text-2xl">Add a garment photo</p>
        <p className="text-ink-muted text-sm mt-2">JPG, PNG or WebP · up to 10 MB</p>
        <p className="text-ink-muted text-xs mt-1">Drop, paste, use the webcam, or choose a file</p>
        <input
          ref={libraryInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          aria-hidden
          onChange={onInputChange}
        />
        <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onTakePhoto}
            className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
            aria-label="Take photo with camera"
          >
            Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="rounded-full border border-ink/15 bg-white px-6 py-2 text-sm tracking-wide hover:bg-paper-warm transition"
            aria-label="Choose image from photo library or files"
          >
            Choose file
          </button>
        </div>
        <p className="text-ink-muted text-[11px] mt-4 max-w-md mx-auto leading-relaxed">
          Take photo uses your browser&apos;s camera (built-in webcam on Mac, camera on phone).
          Choose file only if you want an existing image from disk or Photos.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function ProcessingView({ previewUrl }: { previewUrl: string }) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8">
      <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          <p className="font-serif text-xl">Analyzing…</p>
        </div>
        <div className="space-y-3">
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-1/2" />
          <Shimmer className="h-4 w-2/3" />
          <Shimmer className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-paper-warm ${className}`} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

function VariantPanel({
  previewUrl,
  ghostViews,
  activeViewId,
  generating,
  onActivate,
  onRemoveGhost,
}: {
  previewUrl: string;
  ghostViews: GhostView[];
  activeViewId: string | null;
  generating: boolean;
  onActivate: (id: string | null) => void;
  onRemoveGhost: (id: string) => void;
}) {
  const activeGhost = ghostViews.find((v) => v.id === activeViewId);
  const activeSrc = activeGhost ? imageUrl(activeGhost.imagePath) : previewUrl;
  const activeAlt = activeGhost ? activeGhost.label : "Original";

  return (
    <div className="space-y-3">
      <div
        className={`rounded-2xl overflow-hidden aspect-square shadow-tile ring-1 ring-inset ring-black/[0.05] ${
          activeGhost ? "bg-neutral-100" : "bg-paper-warm"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeSrc}
          alt={activeAlt}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <ViewThumb
          src={previewUrl}
          label="Original"
          active={activeViewId === null}
          onClick={() => onActivate(null)}
        />
        {ghostViews.map((view) => (
          <div
            key={view.id}
            className="relative flex-shrink-0 w-16 flex flex-col items-center gap-1 group"
          >
            <button
              type="button"
              onClick={() => onActivate(view.id)}
              disabled={generating}
              className={`w-full flex flex-col items-center gap-1 rounded-xl border p-1 transition disabled:opacity-50 ${
                activeViewId === view.id
                  ? "border-ink bg-paper-warm"
                  : "border-ink/10 hover:border-ink/30"
              }`}
            >
              <div className="w-full aspect-square rounded overflow-hidden bg-paper-warm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(view.imagePath)}
                  alt={view.label}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-[9px] uppercase tracking-wide text-ink-muted truncate w-full text-center px-0.5">
                {view.label}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveGhost(view.id);
              }}
              disabled={generating}
              aria-label="Remove ghost preview"
              className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-white/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition shadow-sm border border-ink/10 disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
        {generating && (
          <div className="flex-shrink-0 w-16 flex flex-col items-center gap-1 rounded-xl border border-ink/10 p-1">
            <Shimmer className="w-full aspect-square rounded" />
            <span className="text-[9px] uppercase tracking-wide text-ink-muted">…</span>
          </div>
        )}
      </div>
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
  previewUrl,
  extras,
  pickState,
  generating,
  hasExistingGhostViews,
  onToggleExtra,
  onLabelChange,
  onInstructionsChange,
  onPrimaryChange,
  onCompositionChange,
  onGenerate,
  onCancel,
}: {
  previewUrl: string;
  extras: ExtraImage[];
  pickState: PickImageState;
  generating: boolean;
  hasExistingGhostViews: boolean;
  onToggleExtra: (id: string) => void;
  onLabelChange: (label: string) => void;
  onInstructionsChange: (instructions: string) => void;
  onPrimaryChange: (primaryExtraId: string | null) => void;
  onCompositionChange: (hint: "default" | "rear") => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const canGenerate = pickState.label.trim().length > 0;

  return (
    <div className="space-y-3 rounded-xl border border-ink/10 bg-paper-warm p-3">
      <div>
        <p className="text-xs font-medium">
          {hasExistingGhostViews ? "Generate another view" : "Generate ghost mannequin"}
        </p>
        <p className="text-[11px] text-ink-muted mt-1">
          Name this view. The <span className="font-medium">first image</span> the model sees drives
          pose — add a separate back photo, set it as the main source, choose &quot;Back / rear
          catalog&quot;, then generate.
        </p>
      </div>

      <p className="text-[10px] uppercase tracking-wide text-ink-muted">Main photo for this render</p>
      <select
        value={pickState.primaryExtraId ?? "__listing__"}
        onChange={(e) => {
          const v = e.target.value;
          onPrimaryChange(v === "__listing__" ? null : v);
        }}
        className="w-full text-xs rounded-lg border border-ink/15 px-3 py-2 bg-paper focus:outline-none focus:border-ink/40"
      >
        <option value="__listing__">Listing photo (cropped main)</option>
        {extras.map((extra, i) => (
          <option key={extra.id} value={extra.id}>
            Extra source {i + 1}
          </option>
        ))}
      </select>

      <fieldset className="space-y-1.5 border-0 p-0 m-0">
        <legend className="text-[10px] uppercase tracking-wide text-ink-muted">Catalog angle</legend>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name="add-flow-composition"
            checked={pickState.compositionHint === "default"}
            onChange={() => onCompositionChange("default")}
            className="accent-ink"
          />
          Front (default)
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name="add-flow-composition"
            checked={pickState.compositionHint === "rear"}
            onChange={() => onCompositionChange("rear")}
            className="accent-ink"
          />
          Back / rear catalog
        </label>
      </fieldset>

      <p className="text-[11px] text-ink-muted font-medium">Context images for this generation</p>

      {/* Garment image */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded flex items-center justify-center bg-ink/10 border border-ink/20 flex-shrink-0">
          <svg className="w-3 h-3 text-ink" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7z" />
          </svg>
        </div>
        <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Garment" className="w-full h-full object-cover" />
        </div>
        <span className="text-xs text-ink-muted">
          Listing photo{pickState.primaryExtraId ? " (included as context)" : " (main input)"}
        </span>
      </div>

      {extras.map((extra) => {
        const selected = pickState.selectedExtraIds.includes(extra.id);
        return (
          <label key={extra.id} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleExtra(extra.id)}
              className="w-4 h-4 rounded accent-ink flex-shrink-0"
            />
            <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={extra.previewUrl} alt="" className="w-full h-full object-cover" />
            </div>
            <span className="text-xs text-ink-muted">Context image</span>
          </label>
        );
      })}

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
        <input
          type="text"
          placeholder="e.g. Front flat lay, Back with collar…"
          value={pickState.label}
          onChange={(e) => onLabelChange(e.target.value)}
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
          onChange={(e) => onInstructionsChange(e.target.value)}
          rows={3}
          className="w-full text-xs rounded-lg border border-ink/15 px-3 py-2 bg-paper placeholder:text-ink-muted focus:outline-none focus:border-ink/40 resize-none min-h-[4rem]"
        />
      </label>
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
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReadyView({
  state,
  categories,
  styleTagsList,
  credits,
  extraInputRef,
  webMatchAutofill,
  onTakePhotoExtra,
  onSearchWeb,
  onSelectWebProduct,
  selectedWebProductUrl,
  onChange,
  onRequestGhost,
  onConfirmPick,
  onCancelPick,
  onTogglePickExtra,
  onPickLabelChange,
  onPickInstructionsChange,
  onPickPrimaryChange,
  onPickCompositionChange,
  onActivateView,
  onRemoveGhostView,
  onAddExtra,
  onRemoveExtra,
  onSave,
  onDiscard,
}: {
  state: ReadyState;
  categories: string[];
  styleTagsList: string[];
  credits: number;
  extraInputRef: RefObject<HTMLInputElement | null>;
  webMatchAutofill: boolean;
  onTakePhotoExtra: () => void;
  onSearchWeb: (query: string) => Promise<ProductMatch[]>;
  onSelectWebProduct: (match: ProductMatch) => void;
  selectedWebProductUrl: string | null;
  onChange: (patch: Partial<ItemFormValue>) => void;
  onRequestGhost: () => void;
  onConfirmPick: (pick: PickImageState) => void;
  onCancelPick: () => void;
  onTogglePickExtra: (id: string) => void;
  onPickLabelChange: (label: string) => void;
  onPickInstructionsChange: (instructions: string) => void;
  onPickPrimaryChange: (primaryExtraId: string | null) => void;
  onPickCompositionChange: (hint: "default" | "rear") => void;
  onActivateView: (id: string | null) => void;
  onRemoveGhostView: (id: string) => void;
  onAddExtra: (file: File) => void;
  onRemoveExtra: (id: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const noCredits = credits < 1;
  const hasGhosts = state.ghostViews.length > 0;
  const ghostBtnLabel = state.generatingGhost
    ? "Generating…"
    : hasGhosts
      ? "Generate another view"
      : "Generate ghost mannequin";

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6 space-y-5">
        <VariantPanel
          previewUrl={state.previewUrl}
          ghostViews={state.ghostViews}
          activeViewId={state.activeViewId}
          generating={state.generatingGhost}
          onActivate={onActivateView}
          onRemoveGhost={onRemoveGhostView}
        />

        {/* Ghost mannequin panel */}
        <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">Ghost mannequin</h3>
            <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
              <CreditMark className="h-3 w-3 shrink-0" title="Credits" />
              {credits} credits
            </span>
          </div>

          {state.pickingImages ? (
            <ImagePickerPanel
              previewUrl={state.previewUrl}
              extras={state.extras}
              pickState={state.pickingImages}
              generating={state.generatingGhost}
              onToggleExtra={onTogglePickExtra}
              onLabelChange={onPickLabelChange}
              onInstructionsChange={onPickInstructionsChange}
              onPrimaryChange={onPickPrimaryChange}
              onCompositionChange={onPickCompositionChange}
              hasExistingGhostViews={state.ghostViews.length > 0}
              onGenerate={() =>
                state.pickingImages && onConfirmPick(state.pickingImages)
              }
              onCancel={onCancelPick}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={onRequestGhost}
                disabled={state.generatingGhost || noCredits}
                className="w-full rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
              >
                {ghostBtnLabel}
              </button>
              <p className="text-[11px] text-ink-muted">
                {noCredits
                  ? "Out of credits. Buy more in Settings."
                  : hasGhosts
                    ? "Costs 1 credit. Add context shots below for better accuracy."
                    : "Costs 1 credit per view. Add context shots below for better accuracy."}
              </p>
            </>
          )}

          {state.ghostError && (
            <p role="alert" className="text-[11px] text-red-700">
              {state.ghostError}
            </p>
          )}
        </div>

        {/* Context images panel */}
        <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">Source images</h3>
            <span className="text-[10px] text-ink-muted">{state.extras.length} added</span>
          </div>
          <p className="text-[11px] text-ink-muted">
            Add extra shots (back, label, full-body wear). You can choose which ones to
            include when generating each ghost view — useful for front/back or reversible items.
            Paste from clipboard, take a photo, or pick files.
          </p>
          {state.extras.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {state.extras.map((e) => (
                <li
                  key={e.id}
                  className="relative rounded-xl overflow-hidden bg-paper-warm aspect-square group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onRemoveExtra(e.id)}
                    aria-label="Remove image"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/95 text-ink text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={extraInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="hidden"
            aria-hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              files.forEach(onAddExtra);
              if (extraInputRef.current) extraInputRef.current.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTakePhotoExtra}
              className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm transition"
              aria-label="Take photo for context"
            >
              Take photo
            </button>
            <button
              type="button"
              onClick={() => extraInputRef.current?.click()}
              className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm transition"
              aria-label="Add photos from library or files"
            >
              Add from files
            </button>
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="space-y-6"
      >
        <ProductSearchPanel
          title={webMatchAutofill ? "Web matches" : "Find product online"}
          hint={
            webMatchAutofill
              ? "From your photo (when SerpAPI is on) or search again by keyword."
              : "Optional: search by keyword and pick a listing to copy details into the form."
          }
          matches={webMatchAutofill ? state.analyze.bundle.matches : undefined}
          onSearch={onSearchWeb}
          onSelect={onSelectWebProduct}
          selectedUrl={selectedWebProductUrl}
        />

        <ItemFormFields
          value={state.value}
          onChange={onChange}
          categories={categories}
          styleTags={styleTagsList}
        />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!state.value.name.trim() || state.generatingGhost}
            className="rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            Save to closet
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-full border border-ink/15 px-6 py-2.5 text-sm tracking-wide hover:bg-paper-warm transition"
          >
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}

function SavingView({ previewUrl }: { previewUrl: string }) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6">
        <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          <p className="font-serif text-xl">Saving…</p>
        </div>
        <div className="space-y-3">
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-1/2" />
          <Shimmer className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
