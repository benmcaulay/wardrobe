"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import { ImageCropper } from "@/components/image-cropper";
import { removeBackgroundFromBlob } from "@/lib/client/background-removal";
import type { ItemFormValue } from "@/lib/types";
import {
  analyzeUpload,
  createItem,
  discardUpload,
  saveCutoutFromClient,
  type AnalyzeUploadResponse,
} from "./actions";

type AnalyzeOk = Extract<AnalyzeUploadResponse, { ok: true }>;

type FlowState =
  | { kind: "idle"; error?: string }
  | { kind: "cropping"; sourceUrl: string }
  | { kind: "processing"; previewUrl: string; bgStatus: "running" | "done" | "failed" }
  | {
      kind: "ready";
      previewUrl: string;
      cutoutPreviewUrl: string | null;
      analyze: AnalyzeOk;
      cutoutImagePath: string | null;
      value: ItemFormValue;
      generateGhost: boolean;
    }
  | { kind: "saving"; previewUrl: string; cutoutPreviewUrl: string | null; generateGhost: boolean }
  | { kind: "error"; message: string };

type Props = {
  credits: number;
  autoGenerateGhost: boolean;
};

export function AddItemFlow({ credits, autoGenerateGhost }: Props) {
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setState({ kind: "processing", previewUrl, bgStatus: "running" });

    // Analyze (server-side: saveUpload + vision + reverse search) and bg
    // removal (client-side WASM) run in parallel — both work off the cropped
    // blob and don't depend on each other.
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
    setState({
      kind: "ready",
      previewUrl,
      cutoutPreviewUrl,
      analyze: analyzeRes,
      cutoutImagePath,
      generateGhost: autoGenerateGhost && credits > 0,
      value: {
        name: prefill.name,
        brand: prefill.brand,
        category: prefill.category,
        subcategory: prefill.subcategory,
        colors: prefill.colors,
        priceCents: prefill.priceCents,
        currency: prefill.currency,
        retailer: prefill.retailer,
        productUrl: prefill.productUrl,
        material: prefill.material,
        pattern: prefill.pattern ?? "",
        styleTags: prefill.styleTags,
        season: prefill.season,
        notes: "",
        isWishlist: false,
      },
    });
  }

  function cancelCrop() {
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
    setState({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function patchValue(patch: Partial<ItemFormValue>) {
    setState((s) => (s.kind === "ready" ? { ...s, value: { ...s.value, ...patch } } : s));
  }

  function setGenerateGhost(next: boolean) {
    setState((s) => (s.kind === "ready" ? { ...s, generateGhost: next } : s));
  }

  function onSave() {
    if (state.kind !== "ready") return;
    const snapshot = state;
    setState({
      kind: "saving",
      previewUrl: snapshot.previewUrl,
      cutoutPreviewUrl: snapshot.cutoutPreviewUrl,
      generateGhost: snapshot.generateGhost,
    });
    startTransition(async () => {
      const result = await createItem({
        ...snapshot.value,
        originalImagePath: snapshot.analyze.originalImagePath,
        cutoutImagePath: snapshot.cutoutImagePath,
        sourceData: snapshot.analyze.bundle.sourceData,
        generateGhost: snapshot.generateGhost,
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
        await discardUpload(state.analyze.originalImagePath);
      }
    }
    setState({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
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

      {(state.kind === "ready" || state.kind === "saving") && state.kind === "ready" && (
        <ReadyView
          previewUrl={state.previewUrl}
          cutoutPreviewUrl={state.cutoutPreviewUrl}
          value={state.value}
          generateGhost={state.generateGhost}
          credits={credits}
          saving={false}
          onChange={patchValue}
          onToggleGhost={setGenerateGhost}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}
      {state.kind === "saving" && (
        <SavingView
          previewUrl={state.previewUrl}
          cutoutPreviewUrl={state.cutoutPreviewUrl}
          generatingGhost={state.generateGhost}
        />
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
          First-time bg-removal downloads a ~30MB model — subsequent uploads are
          instant.
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

function VersionPreviews({
  previewUrl,
  cutoutPreviewUrl,
}: {
  previewUrl: string;
  cutoutPreviewUrl: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wide text-ink-muted">
        <span>Original</span>
        <span>{cutoutPreviewUrl ? "Cutout" : "Cutout · n/a"}</span>
      </div>
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
        <div className="rounded-2xl bg-paper-warm aspect-square flex items-center justify-center text-xs text-ink-muted px-4 text-center">
          Background removal didn&apos;t produce a clean cutout. The original
          will still save fine.
        </div>
      )}
    </div>
  );
}

function ReadyView({
  previewUrl,
  cutoutPreviewUrl,
  value,
  generateGhost,
  credits,
  saving,
  onChange,
  onToggleGhost,
  onSave,
  onDiscard,
}: {
  previewUrl: string;
  cutoutPreviewUrl: string | null;
  value: ItemFormValue;
  generateGhost: boolean;
  credits: number;
  saving: boolean;
  onChange: (patch: Partial<ItemFormValue>) => void;
  onToggleGhost: (v: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const noCredits = credits < 1;
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6">
        <VersionPreviews previewUrl={previewUrl} cutoutPreviewUrl={cutoutPreviewUrl} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="space-y-6"
      >
        <ItemFormFields value={value} onChange={onChange} disabled={saving} />

        <label
          className={`flex gap-3 rounded-2xl border p-4 transition cursor-pointer ${
            generateGhost
              ? "border-accent bg-accent-soft/20"
              : "border-ink/10 hover:border-ink/30"
          } ${noCredits ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <input
            type="checkbox"
            checked={generateGhost}
            disabled={saving || noCredits}
            onChange={(e) => onToggleGhost(e.target.checked)}
            className="mt-1 accent-ink"
          />
          <div className="flex-1 text-sm">
            <div className="font-medium">Create a ghost-mannequin photo</div>
            <p className="text-ink-muted text-xs mt-1">
              {noCredits
                ? "You're out of credits — buy more in Settings to enable this."
                : "Costs 1 credit (you have ✨ " + credits + "). Generates a clean studio-style image of just the garment."}
            </p>
          </div>
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !value.name.trim()}
            className="rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {saving ? "Saving…" : generateGhost ? "Save & generate" : "Save to closet"}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-full border border-ink/15 px-6 py-2.5 text-sm tracking-wide hover:bg-paper-warm transition disabled:opacity-50"
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
  generatingGhost,
}: {
  previewUrl: string;
  cutoutPreviewUrl: string | null;
  generatingGhost: boolean;
}) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="md:sticky md:top-6">
        <VersionPreviews previewUrl={previewUrl} cutoutPreviewUrl={cutoutPreviewUrl} />
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          <p className="font-serif text-xl">
            {generatingGhost ? "Saving & generating ghost mannequin…" : "Saving…"}
          </p>
        </div>
        {generatingGhost && (
          <p className="text-xs text-ink-muted">
            With a real provider this takes 15–30 seconds. The stub is instant.
          </p>
        )}
        <div className="space-y-3">
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-1/2" />
          <Shimmer className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
