"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Same-origin image URL (so the canvas isn't CORS-tainted). */
  src: string;
  onCancel: () => void;
  /** Returns a JPEG blob of the edited image. */
  onSave: (blob: Blob) => void | Promise<void>;
};

const MAX_UNDO = 12;

/**
 * MS-Paint-style paint bucket: click a color and everything matching (within a
 * tolerance) becomes pure white. Contiguous by default (like the bucket tool);
 * toggle off to replace that color across the whole image. Useful for snapping
 * a slightly-off white product background to true #ffffff.
 */
export function BackgroundWhitener({ src, onCancel, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialRef = useRef<ImageData | null>(null);
  const undoStack = useRef<ImageData[]>([]);

  const [tolerance, setTolerance] = useState(36);
  const [contiguous, setContiguous] = useState(true);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      initialRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStack.current = [];
      setCanUndo(false);
      setDirty(false);
      setReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setLoadError(true);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  function ctx2d() {
    return canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ready || saving) return;
    const canvas = canvasRef.current;
    const ctx = ctx2d();
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;

    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.current.push(snapshot);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    setCanUndo(true);

    const working = ctx.getImageData(0, 0, canvas.width, canvas.height);
    fillToWhite(working, canvas.width, canvas.height, x, y, tolerance, contiguous);
    ctx.putImageData(working, 0, 0);
    setDirty(true);
  }

  function undo() {
    const ctx = ctx2d();
    const prev = undoStack.current.pop();
    if (!ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setCanUndo(undoStack.current.length > 0);
    setDirty(undoStack.current.length > 0);
  }

  function reset() {
    const ctx = ctx2d();
    if (!ctx || !initialRef.current) return;
    ctx.putImageData(initialRef.current, 0, 0);
    undoStack.current = [];
    setCanUndo(false);
    setDirty(false);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          0.92,
        ),
      );
      await onSave(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden bg-[repeating-conic-gradient(#e9e9ec_0_25%,#f7f7f9_0_50%)] bg-[length:20px_20px] ring-1 ring-inset ring-black/[0.06] flex items-center justify-center max-h-[min(60vh,640px)]">
        {loadError ? (
          <p className="p-8 text-sm text-ink-muted">Couldn’t load the image.</p>
        ) : (
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            className="max-w-full max-h-[min(60vh,640px)] object-contain cursor-crosshair"
            style={{ imageRendering: "auto" }}
          />
        )}
      </div>

      <p className="text-xs text-ink-muted">
        Click a background color to paint it pure white — like the paint-bucket in MS Paint. Click
        again to catch any leftover patches. Raise tolerance if an off-white area doesn’t fully
        fill; lower it if it bleeds into the garment.
      </p>

      <label className="block text-xs">
        <span className="text-ink-muted">Tolerance ({tolerance})</span>
        <input
          type="range"
          min={0}
          max={120}
          step={1}
          value={tolerance}
          onChange={(e) => setTolerance(Number(e.target.value))}
          className="mt-1 w-full accent-ink"
        />
      </label>

      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={contiguous}
          onChange={(e) => setContiguous(e.target.checked)}
          className="accent-ink"
        />
        <span>
          Fill connected area only
          <span className="block text-[11px] text-ink-muted">
            Off = replace that color everywhere in the photo.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || !ready || !dirty}
          className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save photo"}
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo || saving}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm hover:bg-paper-warm transition disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || saving}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm hover:bg-paper-warm transition disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm hover:bg-paper-warm transition disabled:opacity-50 ml-auto"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Paint pixels matching the seed color at (sx, sy) to pure white. `tol` is the
 * max per-channel difference. When `contiguous`, only the connected region
 * reachable from the seed is filled (4-neighbour flood fill).
 */
function fillToWhite(
  img: ImageData,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tol: number,
  contiguous: boolean,
) {
  const data = img.data;
  const si = (sy * w + sx) * 4;
  const tr = data[si]!;
  const tg = data[si + 1]!;
  const tb = data[si + 2]!;

  const within = (i: number) =>
    Math.abs(data[i]! - tr) <= tol &&
    Math.abs(data[i + 1]! - tg) <= tol &&
    Math.abs(data[i + 2]! - tb) <= tol;
  const paint = (i: number) => {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  };

  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) if (within(i)) paint(i);
    return;
  }

  const total = w * h;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const start = sy * w + sx;
  visited[start] = 1;
  stack[top++] = start;

  while (top > 0) {
    const p = stack[--top]!;
    const i = p * 4;
    if (!within(i)) continue;
    paint(i);
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0 && !visited[p - 1]) {
      visited[p - 1] = 1;
      stack[top++] = p - 1;
    }
    if (x < w - 1 && !visited[p + 1]) {
      visited[p + 1] = 1;
      stack[top++] = p + 1;
    }
    if (y > 0 && !visited[p - w]) {
      visited[p - w] = 1;
      stack[top++] = p - w;
    }
    if (y < h - 1 && !visited[p + w]) {
      visited[p + w] = 1;
      stack[top++] = p + w;
    }
  }
}
