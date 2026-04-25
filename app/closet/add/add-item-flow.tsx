"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import { ImageCropper } from "@/components/image-cropper";
import { removeBackgroundFromBlob } from "@/lib/client/background-removal";
import { imageUrl } from "@/lib/image-paths";
import { previewGhostMannequin } from "@/lib/actions/ghost-mannequin";
import { mapCategoryToGhost } from "@/lib/services/ghost-mannequin-shared";
import type { ItemFormValue } from "@/lib/types";
import {
  analyzeUpload,
  createItem,
  discardUpload,
  discardExtraImage,
  saveCutoutFromClient,
  saveExtraImage,
  type AnalyzeUploadResponse,
} from "./actions";

type AnalyzeOk = Extract<AnalyzeUploadResponse, { ok: true }>;

type ExtraImage = { id: string; path: string; previewUrl: string };

type ReadyState = {
  kind: "ready";
  previewUrl: string;
  cutoutPreviewUrl: string | null;
  analyze: AnalyzeOk;
  cutoutImagePath: string | null;
  ghostImagePath: string | null;
  ghostCreditsUsed: number | null;
  generatingGhost: boolean;
  ghostError: string | null;
  extras: ExtraImage[];
  value: ItemFormValue;
};

type FlowState =
  | { kind: "idle"; error?: string }
  | { kind: "cropping"; sourceUrl: string }
  | { kind: "processing"; previewUrl: string }
  | ReadyState
  | { kind: "saving"; previewUrl: string; cutoutPreviewUrl: string | null }
  | { kind: "error"; message: string };

type Props = {
  credits: number;
  autoGenerateGhost: boolean;
};

export function AddItemFlow({ credits: initialCredits, autoGenerateGhost }: Props) {
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const [credits, setCredits] = useState(initialCredits);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraInputRef = useRef<HTMLInputElement>(null);

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
      if ((state.kind === "ready" || state.kind === "saving") && state.cutoutPreviewUrl) {
        URL.revokeObjectURL(state.cutoutPreviewUrl);
      }
      if (state.kind === "ready") {
        for (const e of state.extras) URL.revokeObjectURL(e.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFile(file: File) {
    const sourceUrl = URL.createObjectURL(file);
    setState({ kind: "cropping", sourceUrl });
  }

  async function handleCroppedBlob(blob: Blob) {
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);

    const previewUrl = URL.createObjectURL(blob);
    setState({ kind: "processing", previewUrl });

    const file = new File([blob], "garment.jpg", { type: "image/jpeg" });
    const analyzePromise = (async () => {
      const formData = new FormData();
      formData.append("image", file);
      return analyzeUpload(formData);
    })();
    const cutoutPromise = removeBackgroundFromBlob(blob).catch((err) => {
      console.warn("background removal failed:", err);
      return null;
    });

    const [analyzeRes, cutoutBlob] = await Promise.all([analyzePromise, cutoutPromise]);

    if (!analyzeRes.ok) {
      URL.revokeObjectURL(previewUrl);
      setState({ kind: "error", message: analyzeRes.error });
      return;
    }

    let cutoutImagePath: string | null = null;
    let cutoutPreviewUrl: string | null = null;
    if (cutoutBlob) {
      const cutoutFile = new File([cutoutBlob], "cutout.png", { type: "image/png" });
      const cutoutForm = new FormData();
      cutoutForm.append("cutout", cutoutFile);
      const cutoutRes = await saveCutoutFromClient(cutoutForm);
      if (cutoutRes.ok) {
        cutoutImagePath = cutoutRes.cutoutImagePath;
        cutoutPreviewUrl = URL.createObjectURL(cutoutBlob);
      }
    }

    const prefill = analyzeRes.bundle.prefill;
    const ready: ReadyState = {
      kind: "ready",
      previewUrl,
      cutoutPreviewUrl,
      analyze: analyzeRes,
      cutoutImagePath,
      ghostImagePath: null,
      ghostCreditsUsed: null,
      generatingGhost: false,
      ghostError: null,
      extras: [],
      value: {
        name: prefill.name,
        brand: prefill.brand,
        category: prefill.category,
        subcategory: prefill.subcategory,
        colors: prefill.colors,
        priceCents: prefill.priceCents,
        currency: prefill.currency,
        material: prefill.material,
        pattern: prefill.pattern ?? "",
        styleTags: prefill.styleTags,
        season: prefill.season,
        notes: "",
        isWishlist: false,
      },
    };
    setState(ready);

    if (autoGenerateGhost && credits > 0) {
      // Fire-and-forget — generate runs immediately on a fresh ready state.
      runGhost(ready);
    }
  }

  function cancelCrop() {
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
    setState({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function patchValue(patch: Partial<ItemFormValue>) {
    setState((s) => (s.kind === "ready" ? { ...s, value: { ...s.value, ...patch } } : s));
  }

  async function runGhost(snapshot?: ReadyState) {
    setState((s) => {
      if (s.kind !== "ready") return s;
      return { ...s, generatingGhost: true, ghostError: null };
    });
    const current = snapshot ?? (state.kind === "ready" ? state : null);
    if (!current) return;
    const res = await previewGhostMannequin({
      garmentImagePath: current.cutoutImagePath ?? current.analyze.originalImagePath,
      extraImagePaths: current.extras.map((e) => e.path),
      category: mapCategoryToGhost(current.value.category),
    });
    setState((s) => {
      if (s.kind !== "ready") return s;
      if (!res.ok) return { ...s, generatingGhost: false, ghostError: res.error };
      return {
        ...s,
        generatingGhost: false,
        ghostError: null,
        ghostImagePath: res.ghostImagePath,
        ghostCreditsUsed: res.creditsUsed,
      };
    });
    if (res.ok) setCredits(res.creditsRemaining);
  }

  async function addExtra(file: File) {
    if (state.kind !== "ready") return;
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

  async function removeExtra(id: string) {
    if (state.kind !== "ready") return;
    const target = state.extras.find((e) => e.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.previewUrl);
    setState((s) =>
      s.kind === "ready" ? { ...s, extras: s.extras.filter((e) => e.id !== id) } : s,
    );
    await discardExtraImage(target.path);
  }

  function onSave() {
    if (state.kind !== "ready") return;
    const snapshot = state;
    setState({
      kind: "saving",
      previewUrl: snapshot.previewUrl,
      cutoutPreviewUrl: snapshot.cutoutPreviewUrl,
    });
    startTransition(async () => {
      const result = await createItem({
        ...snapshot.value,
        originalImagePath: snapshot.analyze.originalImagePath,
        cutoutImagePath: snapshot.cutoutImagePath,
        ghostImagePath: snapshot.ghostImagePath,
        ghostCreditsUsed: snapshot.ghostCreditsUsed ?? undefined,
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
      if (state.cutoutPreviewUrl) URL.revokeObjectURL(state.cutoutPreviewUrl);
      if (state.kind === "ready") {
        for (const e of state.extras) URL.revokeObjectURL(e.previewUrl);
        await Promise.all([
          discardUpload(state.analyze.originalImagePath),
          ...state.extras.map((e) => discardExtraImage(e.path)),
        ]);
      }
    }
    setState({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (extraInputRef.current) extraInputRef.current.value = "";
  }

  return (
    <div className="space-y-8">
      {state.kind === "idle" && (
        <IdleView onFile={handleFile} fileInputRef={fileInputRef} error={state.error} />
      )}

      {state.kind === "cropping" && (
        <ImageCropper src={state.sourceUrl} onCancel={cancelCrop} onConfirm={handleCroppedBlob} />
      )}

      {state.kind === "processing" && <ProcessingView previewUrl={state.previewUrl} />}

      {state.kind === "ready" && (
        <ReadyView
          state={state}
          credits={credits}
          extraInputRef={extraInputRef}
          onChange={patchValue}
          onGenerateGhost={() => runGhost()}
          onAddExtra={addExtra}
          onRemoveExtra={removeExtra}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}

      {state.kind === "saving" && (
        <SavingView previewUrl={state.previewUrl} cutoutPreviewUrl={state.cutoutPreviewUrl} />
      )}

      {state.kind === "error" && (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
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
    </div>
  );
}

function IdleView({
  onFile,
  fileInputRef,
  error,
}: {
  onFile: (f: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  error?: string;
}) {
  const [dragActive, setDragActive] = useState(false);
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
        <p className="font-serif text-2xl">Drop a photo here</p>
        <p className="text-ink-muted text-sm mt-2">JPG, PNG or WebP, up to 10MB</p>
        <div className="mt-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Or pick a file
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
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
          <p className="font-serif text-xl">Removing background &amp; analyzing…</p>
        </div>
        <p className="text-xs text-ink-muted">
          First-time bg-removal downloads a ~30MB model — subsequent uploads are instant.
        </p>
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
  cutoutPreviewUrl,
  ghostImagePath,
  generating,
}: {
  previewUrl: string;
  cutoutPreviewUrl: string | null;
  ghostImagePath: string | null;
  generating: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square shadow-tile">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wide text-ink-muted">
        <span>Original</span>
        <span>{cutoutPreviewUrl ? "Cutout" : "Cutout · n/a"}</span>
        <span>{ghostImagePath ? "✨ Ghost" : generating ? "Generating…" : "Ghost · pending"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cutoutPreviewUrl ? (
          <div
            className="rounded-2xl overflow-hidden aspect-square"
            style={{
              backgroundImage:
                "linear-gradient(45deg, #efe6d8 25%, transparent 25%), linear-gradient(-45deg, #efe6d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #efe6d8 75%), linear-gradient(-45deg, transparent 75%, #efe6d8 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
              backgroundColor: "#faf8f5",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cutoutPreviewUrl} alt="Cutout" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="rounded-2xl bg-paper-warm aspect-square flex items-center justify-center text-[11px] text-ink-muted px-4 text-center">
            Background removal didn&apos;t produce a clean cutout.
          </div>
        )}
        {ghostImagePath ? (
          <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(ghostImagePath)}
              alt="Ghost mannequin"
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-paper-warm aspect-square flex items-center justify-center text-[11px] text-ink-muted px-4 text-center">
            {generating ? (
              <Shimmer className="h-full w-full" />
            ) : (
              <>Click <span className="font-medium mx-1">Generate</span> to create the ghost-mannequin.</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadyView({
  state,
  credits,
  extraInputRef,
  onChange,
  onGenerateGhost,
  onAddExtra,
  onRemoveExtra,
  onSave,
  onDiscard,
}: {
  state: ReadyState;
  credits: number;
  extraInputRef: React.RefObject<HTMLInputElement>;
  onChange: (patch: Partial<ItemFormValue>) => void;
  onGenerateGhost: () => void;
  onAddExtra: (file: File) => void;
  onRemoveExtra: (id: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const noCredits = credits < 1;
  const ghostBtnLabel = state.generatingGhost
    ? "Generating…"
    : state.ghostImagePath
      ? "Regenerate"
      : "Generate ghost mannequin";

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6 space-y-5">
        <VariantPanel
          previewUrl={state.previewUrl}
          cutoutPreviewUrl={state.cutoutPreviewUrl}
          ghostImagePath={state.ghostImagePath}
          generating={state.generatingGhost}
        />

        <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">Ghost mannequin</h3>
            <span className="text-[10px] text-ink-muted">✨ {credits} credits</span>
          </div>
          <button
            type="button"
            onClick={onGenerateGhost}
            disabled={state.generatingGhost || noCredits}
            className="w-full rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {ghostBtnLabel}
          </button>
          <p className="text-[11px] text-ink-muted">
            {noCredits
              ? "Out of credits. Buy more in Settings."
              : `Costs 1 credit. Add context shots below for better accuracy.`}
          </p>
          {state.ghostError && (
            <p role="alert" className="text-[11px] text-red-700">
              {state.ghostError}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">
              Context images
            </h3>
            <span className="text-[10px] text-ink-muted">{state.extras.length} added</span>
          </div>
          <p className="text-[11px] text-ink-muted">
            Optional. Different angles, label shots, or full-body wear photos —
            passed to the ghost-mannequin model for better accuracy.
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
                    aria-label="Remove context image"
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
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              files.forEach(onAddExtra);
              if (extraInputRef.current) extraInputRef.current.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => extraInputRef.current?.click()}
            className="rounded-full border border-ink/15 px-4 py-1.5 text-xs hover:bg-paper-warm transition"
          >
            + Add photos
          </button>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="space-y-6"
      >
        <ItemFormFields value={state.value} onChange={onChange} />

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

function SavingView({
  previewUrl,
  cutoutPreviewUrl,
}: {
  previewUrl: string;
  cutoutPreviewUrl: string | null;
}) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6 space-y-3">
        <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
        </div>
        {cutoutPreviewUrl && (
          <div className="rounded-2xl overflow-hidden aspect-square bg-paper-warm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cutoutPreviewUrl} alt="" className="w-full h-full object-contain" />
          </div>
        )}
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
