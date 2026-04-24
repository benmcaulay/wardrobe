"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemFormFields } from "@/components/item-form-fields";
import { ImageCropper } from "@/components/image-cropper";
import type { ItemFormValue } from "@/lib/types";
import {
  analyzeUpload,
  createItem,
  discardUpload,
  type AnalyzeUploadResponse,
} from "./actions";

type FlowState =
  | { kind: "idle"; error?: string }
  | { kind: "cropping"; sourceUrl: string }
  | { kind: "analyzing"; previewUrl: string }
  | { kind: "ready"; previewUrl: string; response: Extract<AnalyzeUploadResponse, { ok: true }>; value: ItemFormValue }
  | { kind: "saving"; previewUrl: string; response: Extract<AnalyzeUploadResponse, { ok: true }>; value: ItemFormValue }
  | { kind: "error"; message: string };

export function AddItemFlow() {
  const [state, setState] = useState<FlowState>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up any object URLs we've created for previews / cropper sources.
  useEffect(() => {
    return () => {
      if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
      if (state.kind === "analyzing" || state.kind === "ready" || state.kind === "saving") {
        URL.revokeObjectURL(state.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFile(file: File) {
    const sourceUrl = URL.createObjectURL(file);
    setState({ kind: "cropping", sourceUrl });
  }

  async function handleCroppedBlob(blob: Blob) {
    // Revoke the cropper's source URL now that we've captured the crop.
    if (state.kind === "cropping") URL.revokeObjectURL(state.sourceUrl);
    const file = new File([blob], "garment.jpg", { type: "image/jpeg" });
    const previewUrl = URL.createObjectURL(blob);
    setState({ kind: "analyzing", previewUrl });

    const formData = new FormData();
    formData.append("image", file);
    const response = await analyzeUpload(formData);
    if (!response.ok) {
      URL.revokeObjectURL(previewUrl);
      setState({ kind: "error", message: response.error });
      return;
    }
    const prefill = response.bundle.prefill;
    setState({
      kind: "ready",
      previewUrl,
      response,
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

  function onSave() {
    if (state.kind !== "ready") return;
    const snapshot = state;
    setState({ ...snapshot, kind: "saving" });
    startTransition(async () => {
      const result = await createItem({
        ...snapshot.value,
        originalImagePath: snapshot.response.originalImagePath,
        sourceData: snapshot.response.bundle.sourceData,
      });
      if (!result.ok) {
        setState({ ...snapshot, kind: "ready" });
        setState((s) => ({ ...(s as typeof snapshot), kind: "error", message: result.error }));
        return;
      }
      router.push(`/closet/${result.itemId}`);
    });
  }

  async function onDiscard() {
    const origPath =
      state.kind === "ready" || state.kind === "saving"
        ? state.response.originalImagePath
        : null;
    if (origPath) await discardUpload(origPath);
    if (state.kind === "ready" || state.kind === "saving") URL.revokeObjectURL(state.previewUrl);
    setState({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-8">
      {state.kind === "idle" && <IdleView onFile={handleFile} fileInputRef={fileInputRef} error={state.error} />}

      {state.kind === "cropping" && (
        <ImageCropper src={state.sourceUrl} onCancel={cancelCrop} onConfirm={handleCroppedBlob} />
      )}

      {state.kind === "analyzing" && <AnalyzingView previewUrl={state.previewUrl} />}

      {(state.kind === "ready" || state.kind === "saving") && (
        <ReadyView
          previewUrl={state.previewUrl}
          value={state.value}
          saving={state.kind === "saving"}
          onChange={patchValue}
          onSave={onSave}
          onDiscard={onDiscard}
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

function AnalyzingView({ previewUrl }: { previewUrl: string }) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8">
      <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          <p className="font-serif text-xl">Analyzing your piece…</p>
        </div>
        <div className="space-y-3">
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-1/2" />
          <Shimmer className="h-4 w-2/3" />
          <Shimmer className="h-24 w-full" />
          <Shimmer className="h-4 w-1/3" />
        </div>
      </div>
    </div>
  );
}

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-paper-warm ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

function ReadyView({
  previewUrl,
  value,
  saving,
  onChange,
  onSave,
  onDiscard,
}: {
  previewUrl: string;
  value: ItemFormValue;
  saving: boolean;
  onChange: (patch: Partial<ItemFormValue>) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 items-start">
      <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square sticky top-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Cropped garment" className="w-full h-full object-cover" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="space-y-6"
      >
        <ItemFormFields value={value} onChange={onChange} disabled={saving} />
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !value.name.trim()}
            className="rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save to closet"}
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
