"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

/** Below 1 the image is smaller than the crop frame so you can pan (e.g. center shoes with margins). */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

type Props = {
  /** Object URL for the source image. */
  src: string;
  /** Fixed aspect ratio when not using native dimensions. Default 1 (square) — matches the closet grid tile. */
  aspect?: number;
  onCancel: () => void;
  /** Returns a freshly-generated JPEG blob of the cropped (or fitted) region. */
  onConfirm: (blob: Blob) => void | Promise<void>;
};

export function ImageCropper({ src, aspect = 1, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);
  // When true, fit the ENTIRE photo into a square with white margins (nothing
  // cropped) instead of cropping to a square subset.
  const [fitWhole, setFitWhole] = useState(false);

  useEffect(() => {
    setFitWhole(false);
    setNativeSize(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
    let cancelled = false;
    void loadImage(src).then((img) => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNativeSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const isSquare = !!nativeSize && nativeSize.w === nativeSize.h;

  const onCropComplete = useCallback((_: Area, ap: Area) => {
    setAreaPixels(ap);
  }, []);

  async function handleConfirm() {
    setWorking(true);
    try {
      const blob = fitWhole
        ? await fitWholeToSquareBlob(src)
        : areaPixels
          ? await cropToBlob(src, areaPixels)
          : null;
      if (blob) await onConfirm(blob);
    } finally {
      setWorking(false);
    }
  }

  const confirmDisabled = working || (fitWhole ? !nativeSize : !areaPixels);

  return (
    <div className="space-y-4">
      {fitWhole ? (
        <div className="relative w-full max-h-[min(70vh,880px)] mx-auto rounded-2xl overflow-hidden bg-surface ring-1 ring-inset ring-ink/10 aspect-square flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Full photo preview"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div
          className="relative w-full max-h-[min(70vh,880px)] mx-auto rounded-2xl overflow-hidden bg-ink/90"
          style={{ aspectRatio: "1 / 1" }}
        >
          <Cropper
            key={`${src}-${aspect}`}
            image={src}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            restrictPosition={false}
            objectFit="contain"
          />
        </div>
      )}

      <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 accent-ink"
          checked={fitWhole}
          disabled={!nativeSize}
          onChange={(e) => setFitWhole(e.target.checked)}
        />
        <span>
          <span className="text-ink">Fit whole photo (white margins)</span>
          <span className="block text-[11px] text-ink-muted mt-0.5">
            {isSquare
              ? "This photo is already square, so this has no effect."
              : "Centers the entire photo in a square and pads the sides with white — nothing gets cropped. Turn off to crop to a square."}
          </span>
        </span>
      </label>

      {!fitWhole && (
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-ink-muted">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            aria-label="Zoom"
            className="mt-1 w-full accent-ink"
          />
        </label>
      )}

      <p className="text-xs text-ink-muted">
        {fitWhole
          ? "The full photo is shown centered on white to match the square closet tiles."
          : "Drag to reposition. Zoom out past 1× if you need more room to center the subject; empty margins export as white."}
      </p>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {working ? "Working…" : fitWhole ? "Use full photo" : "Use this crop"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="rounded-full border border-ink/15 px-5 py-2 text-sm hover:bg-paper-warm transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Draw the entire source image centered on a square white canvas (side = the
 * image's longer edge), padding the shorter dimension with white. Preserves the
 * whole item; the result drops straight into square tiles without cropping.
 */
async function fitWholeToSquareBlob(src: string): Promise<Blob> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const side = Math.max(w, h, 1);

  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(img, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);

  return canvasToBlob(canvas);
}

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  const outW = Math.max(1, Math.round(area.width));
  const outH = Math.max(1, Math.round(area.height));
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);

  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const sx0 = area.x;
  const sy0 = area.y;
  const srcLeft = Math.max(0, Math.floor(sx0));
  const srcTop = Math.max(0, Math.floor(sy0));
  const srcRight = Math.min(imgW, Math.ceil(sx0 + area.width));
  const srcBottom = Math.min(imgH, Math.ceil(sy0 + area.height));

  if (srcLeft < srcRight && srcTop < srcBottom) {
    const sw = srcRight - srcLeft;
    const sh = srcBottom - srcTop;
    const destX = srcLeft - sx0;
    const destY = srcTop - sy0;
    ctx.drawImage(img, srcLeft, srcTop, sw, sh, destX, destY, sw, sh);
  }

  return canvasToBlob(canvas);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      0.92,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}
