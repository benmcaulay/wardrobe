"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { Camera, Hanger, Upload } from "@/components/icons";
import { springSnappy, springSoft } from "@/lib/ui-motion";
import { ItemFormFields } from "@/components/item-form-fields";
import { ProductSearchPanel } from "@/components/product-search-panel";
import { CreditMark } from "@/components/credit-mark";
import { ImageCropper } from "@/components/image-cropper";
import { WebcamCaptureModal } from "@/components/webcam-capture-modal";
import { imageUrl } from "@/lib/image-paths";
import {
  canonicalCategoryChoice,
  isNoneCategoryStored,
  suggestCategoryFromItem,
} from "@/lib/categories";
import { enqueueGhostPreview, getGhostJobStatus } from "@/lib/actions/ghost-mannequin";
import { mapItemToGhost, requireGhostCategory } from "@/lib/services/ghost-mannequin-shared";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/image-upload-accept";
import type { ItemFormValue } from "@/lib/types";
import type { Color, Owner } from "@/lib/json";
import { DEFAULT_OWNERS } from "@/lib/owners";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import {
  analyzeUpload,
  applyProductMatchAction,
  beginFromWebProduct,
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
  /** From the preview job, so the saved ledger row records real spend. */
  model?: string | null;
  costTenthCents?: number;
};
type PickImageState = {
  selectedExtraIds: string[];
  label: string;
  instructions: string;
  /** `null` = main listing crop is the model's first input */
  primaryExtraId: string | null;
  compositionHint: "default" | "rear";
  /** Which entry point opened the panel — decides what starts expanded. */
  mode: "upload" | "ai";
};

type ReadyState = {
  kind: "ready";
  previewUrl: string;
  analyze: AnalyzeOk;
  ghostViews: GhostView[];
  activeViewId: string | null; // null = show original
  /** null = original photo is the closet grid thumbnail */
  primaryViewId: string | null;
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
  /** Per-generation money cost, e.g. "$0.067" or "free in stub mode". */
  costLabel: string;
  autoGenerateGhost: boolean;
  categories: string[];
  styleTagsList: string[];
  ownersList: Owner[];
  colorOptions: Color[];
  webMatchAutofill: boolean;
};

function getClipboardImageFile(e: ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items ?? []);
  const item = items.find((i) => i.type.startsWith("image/"));
  return item ? item.getAsFile() : null;
}

/** Single source of truth, shared with the server (HEIC/HEIF included). */
const IMAGE_ACCEPT = IMAGE_UPLOAD_ACCEPT;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;
const GHOST_PREVIEW_JOB_KEY = "wardrobe:ghost-preview-job";

function clearFileInputs(...refs: Array<RefObject<HTMLInputElement>>) {
  for (const r of refs) {
    if (r.current) r.current.value = "";
  }
}

function buildReadyState(
  previewUrl: string,
  analyze: AnalyzeOk,
  formPatch: Partial<ItemFormValue>,
  categories: string[],
  primaryOwnerId: string,
): ReadyState {
  const merged = { ...analyze.bundle.prefill, ...formPatch };
  // Prefill always ships category "None", making the picker a mandatory detour
  // and blocking AI generation behind requireGhostCategory. Infer it from the
  // name when we can; keep None when we genuinely can't.
  const resolvedCategory = canonicalCategoryChoice(merged.category, categories);
  const category = isNoneCategoryStored(resolvedCategory)
    ? (suggestCategoryFromItem(
        { name: merged.name, subcategory: merged.subcategory },
        categories,
      ) ?? resolvedCategory)
    : resolvedCategory;
  return {
    kind: "ready",
    previewUrl,
    analyze,
    ghostViews: [],
    activeViewId: null,
    primaryViewId: null,
    generatingGhost: false,
    ghostError: null,
    extras: [],
    value: {
      name: merged.name ?? "",
      brand: merged.brand ?? "",
      category,
      subcategory: merged.subcategory ?? "",
      colors: merged.colors ?? [],
      priceCents: merged.priceCents ?? null,
      currency: merged.currency ?? "USD",
      material: merged.material ?? "",
      pattern: merged.pattern ?? "",
      styleTags: merged.styleTags ?? [],
      season: merged.season ?? [],
      owners: merged.owners ?? [primaryOwnerId],
      notes: "",
      isWishlist: false,
    },
    pickingImages: null,
  };
}

export function AddItemFlow({
  credits: initialCredits,
  costLabel,
  autoGenerateGhost,
  categories,
  styleTagsList,
  ownersList,
  colorOptions,
  webMatchAutofill,
}: Props) {
  const primaryOwnerId = ownersList[0]?.id ?? DEFAULT_OWNERS[0]!.id;
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const [credits, setCredits] = useState(initialCredits);
  const [webcam, setWebcam] = useState<null | { facing: "environment" | "user" }>(null);
  const [pendingFormPatch, setPendingFormPatch] = useState<Partial<ItemFormValue> | null>(null);
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [webSearchResults, setWebSearchResults] = useState<ProductMatch[]>([]);
  const [selectedWebProductUrl, setSelectedWebProductUrl] = useState<string | null>(null);
  const webcamHandlerRef = useRef<(file: File) => void>(() => {});

  function clearWebSelection() {
    setSelectedWebProductUrl(null);
  }

  function resetWebSearch() {
    setWebSearchQuery("");
    setWebSearchResults([]);
    setSelectedWebProductUrl(null);
  }

  function openWebcamCapture(facing: "environment" | "user", onFile: (file: File) => void) {
    webcamHandlerRef.current = onFile;
    setWebcam({ facing });
  }

  const libraryInputRef = useRef<HTMLInputElement>(null);
  const extraInputRef = useRef<HTMLInputElement>(null);
  const pollGenRef = useRef(0);

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

  async function addManualView(file: File) {
    if (state.kind !== "ready") return;
    const formData = new FormData();
    formData.append("image", file);
    const res = await saveExtraImage(formData);
    if (!res.ok) {
      setState((s) => (s.kind === "ready" ? { ...s, ghostError: res.error } : s));
      return;
    }
    const labelFromPick = state.pickingImages?.label.trim() ?? "";
    setState((s) => {
      if (s.kind !== "ready") return s;
      const label =
        labelFromPick ||
        (s.ghostViews.length === 0 ? "View" : `View ${s.ghostViews.length + 1}`);
      const newView: GhostView = {
        id: crypto.randomUUID(),
        label,
        imagePath: res.imagePath,
        creditsUsed: 0,
      };
      return {
        ...s,
        ghostViews: [...s.ghostViews, newView],
        activeViewId: newView.id,
        primaryViewId: s.primaryViewId ?? newView.id,
        pickingImages: null,
        ghostError: null,
      };
    });
  }

  // Update paste handler each render so it always captures current state/functions
  pasteHandlerRef.current = (e: ClipboardEvent) => {
    const file = getClipboardImageFile(e);
    if (!file) return;
    if (state.kind === "idle") {
      e.preventDefault();
      handleFile(file);
    } else if (state.kind === "ready" && state.pickingImages) {
      e.preventDefault();
      void addManualView(file);
    } else if (state.kind === "ready" && !state.pickingImages) {
      e.preventDefault();
      void addExtra(file);
    }
  };

  async function onSelectWebProduct(match: ProductMatch) {
    setSelectedWebProductUrl(match.url);

    // From the idle screen: import the listing photo and jump straight to the form.
    if (state.kind === "idle") {
      if (!match.thumbnailUrl) {
        setState({ kind: "idle", error: "This listing has no product photo to import." });
        return;
      }
      setState({ kind: "processing", previewUrl: match.thumbnailUrl });

      const res = await beginFromWebProduct(match);
      if (!res.ok) {
        setState({ kind: "error", message: res.error });
        return;
      }

      const analyze: AnalyzeOk = {
        ok: true,
        originalImagePath: res.originalImagePath,
        thumbnailImagePath: res.thumbnailImagePath,
        bundle: res.bundle,
      };
      const ready = buildReadyState(imageUrl(res.originalImagePath), analyze, res.patch, categories, primaryOwnerId);
      setState(ready);
      setPendingFormPatch(null);

      // Same gate as the photo path: prefill ships category as None, so an
      // unconditional auto-generate always tripped requireGhostCategory.
      if (autoGenerateGhost && credits > 0 && requireGhostCategory(ready.value).ok) {
        void runGhost(
          {
            selectedExtraIds: [],
            label: "",
            instructions: "",
            primaryExtraId: null,
            compositionHint: "default",
            mode: "ai",
          },
          ready,
        );
      }
      return;
    }

    const res = await applyProductMatchAction(match);
    if (!res.ok) {
      setState((s) => {
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

    const ready = buildReadyState(previewUrl, analyzeRes, pendingFormPatch ?? {}, categories, primaryOwnerId);
    setState(ready);
    setPendingFormPatch(null);
    if (webMatchAutofill && analyzeRes.bundle.matches.length > 0 && webSearchResults.length === 0) {
      setWebSearchResults(analyzeRes.bundle.matches);
    }

    // The category gate refuses an unclassifiable item, and prefill ships
    // category as None — so firing this unconditionally surfaced an error the
    // user did not cause on every single add. Only auto-generate once the item
    // is actually classifiable.
    if (autoGenerateGhost && credits > 0 && requireGhostCategory(ready.value).ok) {
      void runGhost(
        {
          selectedExtraIds: [],
          label: "",
          instructions: "",
          primaryExtraId: null,
          compositionHint: "default",
          mode: "ai",
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
        ? { ...s, generatingGhost: true, ghostError: null }
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

    const enq = await enqueueGhostPreview({
      garmentImagePath: current.analyze.originalImagePath,
      extraImagePaths: selectedExtras,
      primaryGarmentPathOverride: primaryOverridePath,
      category: mapItemToGhost({
        category: current.value.category,
        subcategory: current.value.subcategory,
        name: current.value.name,
      }),
      instructions: instructionsTrimmed || undefined,
      compositionHint: pick.compositionHint,
    });

    if (!enq.ok) {
      setState((s) =>
        s.kind === "ready"
          ? { ...s, generatingGhost: false, ghostError: enq.error, pickingImages: null }
          : s,
      );
      return;
    }

    startGhostPreviewPoll(enq.jobId, viewLabel, current.analyze.originalImagePath);
  }

  function applyGhostPreviewResult(
    res: {
      ghostImagePath: string;
      creditsRemaining: number;
      creditsUsed?: number;
      model?: string | null;
      costTenthCents?: number;
    },
    viewLabel: string,
  ) {
    setState((s) => {
      if (s.kind !== "ready") return s;
      const newView: GhostView = {
        id: crypto.randomUUID(),
        label: viewLabel,
        imagePath: res.ghostImagePath,
        creditsUsed: res.creditsUsed ?? 1,
        model: res.model ?? null,
        costTenthCents: res.costTenthCents ?? 0,
      };
      return {
        ...s,
        generatingGhost: false,
        ghostError: null,
        pickingImages: null,
        ghostViews: [...s.ghostViews, newView],
        activeViewId: newView.id,
        // First catalog view wins the thumbnail — a clean render beats the
        // listing snapshot. Later renders leave an explicit choice alone.
        primaryViewId: s.ghostViews.length === 0 ? newView.id : s.primaryViewId,
      };
    });
    setCredits(res.creditsRemaining);
    sessionStorage.removeItem(GHOST_PREVIEW_JOB_KEY);
  }

  async function pollGhostPreviewJob(
    jobId: string,
    viewLabel: string,
    garmentImagePath: string,
    signal: number,
  ) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (pollGenRef.current !== signal) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (pollGenRef.current !== signal) return;
      const status = await getGhostJobStatus(jobId);
      if (pollGenRef.current !== signal) return;
      if (!status.ok) {
        setState((s) =>
          s.kind === "ready"
            ? { ...s, generatingGhost: false, ghostError: status.error, pickingImages: null }
            : s,
        );
        sessionStorage.removeItem(GHOST_PREVIEW_JOB_KEY);
        return;
      }
      if (status.status === "succeeded") {
        applyGhostPreviewResult(status, viewLabel);
        return;
      }
    }
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            generatingGhost: false,
            ghostError: "This is taking longer than expected. Check back shortly.",
          }
        : s,
    );
  }

  function startGhostPreviewPoll(jobId: string, viewLabel: string, garmentImagePath: string) {
    sessionStorage.setItem(
      GHOST_PREVIEW_JOB_KEY,
      JSON.stringify({ jobId, viewLabel, garmentImagePath }),
    );
    setState((s) =>
      s.kind === "ready" ? { ...s, generatingGhost: true, ghostError: null } : s,
    );
    const signal = ++pollGenRef.current;
    void pollGhostPreviewJob(jobId, viewLabel, garmentImagePath, signal).finally(() => {
      if (pollGenRef.current === signal) {
        setState((s) => (s.kind === "ready" ? { ...s, generatingGhost: false } : s));
      }
    });
  }

  useEffect(() => {
    const raw = sessionStorage.getItem(GHOST_PREVIEW_JOB_KEY);
    if (!raw) return;
    let stored: { jobId: string; viewLabel: string; garmentImagePath: string };
    try {
      stored = JSON.parse(raw) as typeof stored;
    } catch {
      sessionStorage.removeItem(GHOST_PREVIEW_JOB_KEY);
      return;
    }
    void (async () => {
      const status = await getGhostJobStatus(stored.jobId);
      if (status.ok && status.status === "succeeded") {
        applyGhostPreviewResult(status, stored.viewLabel);
        return;
      }
      if (!status.ok && status.error !== "Job not found") {
        setState((s) =>
          s.kind === "ready" ? { ...s, ghostError: status.error } : s,
        );
        sessionStorage.removeItem(GHOST_PREVIEW_JOB_KEY);
        return;
      }
      startGhostPreviewPoll(stored.jobId, stored.viewLabel, stored.garmentImagePath);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once on mount
  }, []);

  function requestGhost(mode: "upload" | "ai" = "upload") {
    if (state.kind !== "ready") return;
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            pickingImages: {
              selectedExtraIds: s.extras.map((e) => e.id),
              label: s.ghostViews.length > 0 ? `View ${s.ghostViews.length + 1}` : "Front",
              instructions: "",
              primaryExtraId: null,
              compositionHint: "default",
              mode,
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
      const nextPrimary = s.primaryViewId === id ? null : s.primaryViewId;
      return { ...s, ghostViews: remaining, activeViewId: nextActive, primaryViewId: nextPrimary };
    });
    await discardExtraImage(target.imagePath);
  }

  async function onSave() {
    if (state.kind !== "ready") return;
    const snapshot = state;
    setState({ kind: "saving", previewUrl: snapshot.previewUrl });
    try {
      const primaryGhostPath =
        snapshot.primaryViewId === null
          ? null
          : snapshot.ghostViews.find((v) => v.id === snapshot.primaryViewId)?.imagePath ?? null;
      const result = await createItem({
        ...snapshot.value,
        originalImagePath: snapshot.analyze.originalImagePath,
        ghostImagePath: primaryGhostPath,
        ghostViews: snapshot.ghostViews.map((v) => ({
          label: v.label,
          imagePath: v.imagePath,
          creditsUsed: v.creditsUsed,
          model: v.model ?? null,
          costTenthCents: v.costTenthCents ?? 0,
        })),
        extraImagePaths: snapshot.extras.map((e) => e.path),
        sourceData: snapshot.analyze.bundle.sourceData,
      });
      if (!result.ok) {
        setState({ kind: "error", message: result.error });
        return;
      }
      // Full navigation — client-side router.push can leave "Saving…" up indefinitely
      // while Next.js compiles the destination route on first visit in dev.
      window.location.assign(`/closet/${result.itemId}`);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message ?? "Could not save item" });
    }
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
    resetWebSearch();
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
                : "Pick a result to import its photo and pre-fill the form — or add your own photo below."
            }
            query={webSearchQuery}
            onQueryChange={setWebSearchQuery}
            results={webSearchResults}
            onResultsChange={setWebSearchResults}
            onSearch={runWebSearch}
            onSelect={(m) => void onSelectWebProduct(m)}
            selectedUrl={selectedWebProductUrl}
            onClearSelection={clearWebSelection}
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
          costLabel={costLabel}
          categories={categories}
          styleTagsList={styleTagsList}
          ownersList={ownersList}
          colorOptions={colorOptions}
          credits={credits}
          extraInputRef={extraInputRef}
          onTakePhotoExtra={() => openWebcamCapture("environment", addExtra)}
          webMatchAutofill={webMatchAutofill}
          webSearchQuery={webSearchQuery}
          onWebSearchQueryChange={setWebSearchQuery}
          webSearchResults={webSearchResults}
          onWebSearchResultsChange={setWebSearchResults}
          onSearchWeb={runWebSearch}
          onSelectWebProduct={(m) => void onSelectWebProduct(m)}
          selectedWebProductUrl={selectedWebProductUrl}
          onClearWebSelection={clearWebSelection}
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
          onSetPrimaryView={(id) =>
            setState((s) => (s.kind === "ready" ? { ...s, primaryViewId: id } : s))
          }
          onRemoveGhostView={(id) => void removeGhostView(id)}
          onAddExtra={addExtra}
          onAddManualView={(file) => void addManualView(file)}
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
  libraryInputRef: RefObject<HTMLInputElement>;
  onTakePhoto: () => void;
  error?: string;
}) {
  const [dragActive, setDragActive] = useState(false);
  const reduce = useReducedMotion();

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  }

  // Staggered entrance: the panel settles, then its contents arrive in order.
  const item = {
    hidden: reduce ? {} : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div>
      {/* The whole panel is the file picker — a <label> over the hidden input
          means clicking anywhere in the dropzone opens it, instead of requiring
          a hit on a 100px pill. Keyboard users still get the two buttons. */}
      <motion.label
        htmlFor="add-garment-file"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
        whileHover={reduce ? undefined : { scale: 1.004 }}
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
        className={`block cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-colors ${
          dragActive ? "border-accent bg-accent-soft/20" : "border-ink/15 bg-paper-warm hover:border-ink/30"
        }`}
      >
        <motion.div
          animate={
            reduce
              ? undefined
              : dragActive
                ? { scale: 1.12, rotate: -3 }
                : { scale: 1, rotate: 0 }
          }
          transition={springSnappy}
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-paper"
        >
          <Hanger className="h-7 w-7" />
        </motion.div>

        <p className="font-serif text-2xl">
          {dragActive ? "Drop it right here" : "Add a garment photo"}
        </p>
        <p className="text-ink-muted text-sm mt-2">
          Drop, paste, snap, or click anywhere in this panel
        </p>

        <input
          id="add-garment-file"
          ref={libraryInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={onInputChange}
        />

        <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2 sm:gap-3">
          <motion.button
            type="button"
            // Stop the label from also opening the file picker.
            onClick={(e) => {
              e.preventDefault();
              onTakePhoto();
            }}
            whileHover={reduce ? undefined : { scale: 1.04 }}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={springSnappy}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft"
            aria-label="Take photo with camera"
          >
            <Camera className="h-4 w-4" />
            Take photo
          </motion.button>
          <motion.button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              libraryInputRef.current?.click();
            }}
            whileHover={reduce ? undefined : { scale: 1.04 }}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={springSnappy}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 bg-white px-6 py-2 text-sm tracking-wide hover:bg-paper-warm"
            aria-label="Choose image from photo library or files"
          >
            <Upload className="h-4 w-4" />
            Choose file
          </motion.button>
        </div>

        <p className="text-ink-muted text-[11px] mt-4">JPG, PNG, WebP or HEIC · up to 10 MB</p>
      </motion.label>
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
  primaryViewId,
  generating,
  onActivate,
  onSetPrimary,
  onRemoveGhost,
}: {
  previewUrl: string;
  ghostViews: GhostView[];
  activeViewId: string | null;
  primaryViewId: string | null;
  generating: boolean;
  onActivate: (id: string | null) => void;
  onSetPrimary: (id: string | null) => void;
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
          isPrimary={primaryViewId === null}
          onClick={() => onActivate(null)}
          onSetPrimary={() => onSetPrimary(null)}
        />
        {ghostViews.map((view) => (
          <div
            key={view.id}
            className="relative flex-shrink-0 w-16 flex flex-col items-center gap-1 group"
          >
            <ViewThumb
              src={imageUrl(view.imagePath)}
              label={view.label}
              active={activeViewId === view.id}
              isPrimary={primaryViewId === view.id}
              onClick={() => onActivate(view.id)}
              onSetPrimary={() => onSetPrimary(view.id)}
            />
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
  isPrimary,
  onClick,
  onSetPrimary,
}: {
  src: string;
  label: string;
  active: boolean;
  isPrimary?: boolean;
  onClick: () => void;
  onSetPrimary?: () => void;
}) {
  return (
    <div className="relative flex-shrink-0 w-16 flex flex-col items-center gap-1 group">
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex flex-col items-center gap-1 rounded-xl border p-1 transition ${
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
        {isPrimary && (
          <span className="text-[8px] uppercase tracking-wide text-ink-muted">Primary</span>
        )}
      </button>
      {onSetPrimary && !isPrimary && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetPrimary();
          }}
          className="text-[8px] text-ink-muted hover:text-ink underline underline-offset-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          Set primary
        </button>
      )}
    </div>
  );
}

function ImagePickerPanel({
  costLabel,
  previewUrl,
  extras,
  pickState,
  generating,
  hasExistingGhostViews,
  canGenerate,
  onToggleExtra,
  onLabelChange,
  onInstructionsChange,
  onPrimaryChange,
  onCompositionChange,
  onGenerate,
  onCancel,
  onAddManualView,
}: {
  costLabel: string;
  previewUrl: string;
  extras: ExtraImage[];
  pickState: PickImageState;
  generating: boolean;
  hasExistingGhostViews: boolean;
  canGenerate: boolean;
  onToggleExtra: (id: string) => void;
  onLabelChange: (label: string) => void;
  onInstructionsChange: (instructions: string) => void;
  onPrimaryChange: (primaryExtraId: string | null) => void;
  onCompositionChange: (hint: "default" | "rear") => void;
  onGenerate: () => void;
  onCancel: () => void;
  onAddManualView: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canAiGenerate = canGenerate && pickState.label.trim().length > 0;
  const aiFirst = pickState.mode === "ai";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-paper-warm p-3">
      <div className="order-1">
        <p className="text-xs font-medium">
          {aiFirst
            ? "Generate with AI"
            : hasExistingGhostViews
              ? "Add another view"
              : "Add catalog view"}
        </p>
        <p className="text-[11px] text-ink-muted mt-1">
          {aiFirst
            ? "The AI render needs a name. You can also upload a photo instead — that adds a view immediately, no credit."
            : "Paste or upload a photo to add it as a view immediately (no AI). Or generate with AI below."}
        </p>
      </div>

      <label className={`${aiFirst ? "order-3" : "order-2"} block space-y-1`}>
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">View name</span>
        <input
          type="text"
          placeholder="e.g. Front flat lay, Back with collar…"
          value={pickState.label}
          onChange={(e) => onLabelChange(e.target.value)}
          disabled={generating}
          className="w-full text-xs rounded-lg border border-ink/15 px-3 py-1.5 bg-white placeholder:text-ink-muted focus:outline-none focus:border-ink/40 disabled:opacity-50"
        />
      </label>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onAddManualView(file);
        }}
      />
      <button
        type="button"
        disabled={generating}
        onClick={() => fileRef.current?.click()}
        className={`${aiFirst ? "order-4" : "order-3"} self-start rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50`}
      >
        Upload photo as view
      </button>

      <details
        open={aiFirst}
        className={`${aiFirst ? "order-2" : "order-5"} rounded-lg border border-ink/10 bg-white p-3`}
      >
        <summary className="text-xs font-medium cursor-pointer list-none">
          {aiFirst ? "Render settings" : `Or generate with AI · 1 credit · ${costLabel}`}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-ink-muted">
            The <span className="font-medium">first image</span> the model sees drives pose — add a
            separate back photo, set it as the main source, choose &quot;Back / rear catalog&quot;,
            then generate.
          </p>

          <p className="text-[10px] uppercase tracking-wide text-ink-muted">
            Main photo for this render
          </p>
          <select
            value={pickState.primaryExtraId ?? "__listing__"}
            onChange={(e) => {
              const v = e.target.value;
              onPrimaryChange(v === "__listing__" ? null : v);
            }}
            className="w-full text-xs rounded-lg border border-ink/15 px-3 py-2 bg-paper focus:outline-none focus:border-ink/40"
          >
            <option value="__listing__">Original photo</option>
            {extras.map((extra, i) => (
              <option key={extra.id} value={extra.id}>
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

          {!canGenerate && (
            <p className="text-[11px] text-ink-muted">Out of credits for AI generation.</p>
          )}
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || !canAiGenerate}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate with AI"}
          </button>
          {generating && (
            <p className="text-[11px] text-ink-muted">
              You can close this panel or save the item — generation continues in the background.
            </p>
          )}
        </div>
      </details>

      <button
        type="button"
        onClick={onCancel}
        className="order-6 self-start rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper transition"
      >
        {generating ? "Close" : "Cancel"}
      </button>
    </div>
  );
}

function ReadyView({
  costLabel,
  state,
  categories,
  styleTagsList,
  ownersList,
  colorOptions,
  credits,
  extraInputRef,
  webMatchAutofill,
  onTakePhotoExtra,
  webSearchQuery,
  onWebSearchQueryChange,
  webSearchResults,
  onWebSearchResultsChange,
  onSearchWeb,
  onSelectWebProduct,
  selectedWebProductUrl,
  onClearWebSelection,
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
  onSetPrimaryView,
  onRemoveGhostView,
  onAddExtra,
  onAddManualView,
  onRemoveExtra,
  onSave,
  onDiscard,
}: {
  state: ReadyState;
  categories: string[];
  styleTagsList: string[];
  ownersList: Owner[];
  colorOptions: Color[];
  credits: number;
  costLabel: string;
  extraInputRef: RefObject<HTMLInputElement>;
  webMatchAutofill: boolean;
  onTakePhotoExtra: () => void;
  webSearchQuery: string;
  onWebSearchQueryChange: (query: string) => void;
  webSearchResults: ProductMatch[];
  onWebSearchResultsChange: (results: ProductMatch[]) => void;
  onSearchWeb: (query: string) => Promise<ProductMatch[]>;
  onSelectWebProduct: (match: ProductMatch) => void;
  selectedWebProductUrl: string | null;
  onClearWebSelection: () => void;
  onChange: (patch: Partial<ItemFormValue>) => void;
  onRequestGhost: (mode: "upload" | "ai") => void;
  onConfirmPick: (pick: PickImageState) => void;
  onCancelPick: () => void;
  onTogglePickExtra: (id: string) => void;
  onPickLabelChange: (label: string) => void;
  onPickInstructionsChange: (instructions: string) => void;
  onPickPrimaryChange: (primaryExtraId: string | null) => void;
  onPickCompositionChange: (hint: "default" | "rear") => void;
  onActivateView: (id: string | null) => void;
  onSetPrimaryView: (id: string | null) => void;
  onRemoveGhostView: (id: string) => void;
  onAddExtra: (file: File) => void;
  onAddManualView: (file: File) => void;
  onRemoveExtra: (id: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const noCredits = credits < 1;
  const hasGhosts = state.ghostViews.length > 0;
  // Generation is refused server-side for an unclassifiable item, so surface it
  // here rather than letting the click fail.
  const categoryCheck = requireGhostCategory({
    category: state.value.category,
    subcategory: state.value.subcategory,
    name: state.value.name,
  });
  const categoryBlocked = !categoryCheck.ok ? categoryCheck.error : null;
  const ghostBtnLabel = hasGhosts ? "Add another view" : "Add catalog view";

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6 space-y-5">
        <VariantPanel
          previewUrl={state.previewUrl}
          ghostViews={state.ghostViews}
          activeViewId={state.activeViewId}
          primaryViewId={state.primaryViewId}
          generating={state.generatingGhost}
          onActivate={onActivateView}
          onSetPrimary={onSetPrimaryView}
          onRemoveGhost={onRemoveGhostView}
        />

        {/* Ghost mannequin panel */}
        <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">Catalog views</h3>
            <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
              <CreditMark className="h-3 w-3 shrink-0" title="Credits" />
              {credits} credits
            </span>
          </div>

          {state.pickingImages ? (
            <ImagePickerPanel
              costLabel={costLabel}
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
              canGenerate={!noCredits}
              onGenerate={() =>
                state.pickingImages && onConfirmPick(state.pickingImages)
              }
              onCancel={onCancelPick}
              onAddManualView={onAddManualView}
            />
          ) : (
            <>
              {state.generatingGhost && (
                <p className="text-[11px] text-ink-muted">
                  Generating in the background — you can keep editing or save without waiting.
                </p>
              )}
              <button
                type="button"
                onClick={() => onRequestGhost("upload")}
                disabled={state.generatingGhost}
                className="w-full rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
              >
                {ghostBtnLabel}
              </button>
              <button
                type="button"
                onClick={() => onRequestGhost("ai")}
                disabled={state.generatingGhost || noCredits || !!categoryBlocked}
                title={
                  categoryBlocked ?? (noCredits ? "Out of credits — buy more in Settings" : undefined)
                }
                className="w-full rounded-full border border-ink/20 px-4 py-2 text-xs tracking-wide hover:bg-paper transition disabled:opacity-50"
              >
                {state.generatingGhost ? "Generating…" : "Generate with AI"}
              </button>
              <p className="text-[11px] text-ink-muted">
                Paste or upload a photo for free, or generate with AI
                {noCredits ? " (out of credits)." : ` (1 credit · ${costLabel}).`}
              </p>
              {categoryBlocked && (
                <p className="text-[11px] text-amber-700">{categoryBlocked}</p>
              )}
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
              ? "From your photo (when SerpAPI is on) or search again by keyword. Clear a selection to browse results."
              : "Search by keyword and pick a listing to copy details into the form. Clear a selection to try another."
          }
          query={webSearchQuery}
          onQueryChange={onWebSearchQueryChange}
          results={webSearchResults}
          onResultsChange={onWebSearchResultsChange}
          onSearch={onSearchWeb}
          onSelect={onSelectWebProduct}
          selectedUrl={selectedWebProductUrl}
          onClearSelection={onClearWebSelection}
        />

        <ItemFormFields
          value={state.value}
          onChange={onChange}
          categories={categories}
          styleTags={styleTagsList}
          owners={ownersList}
          colorOptions={colorOptions}
        />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!state.value.name.trim()}
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
