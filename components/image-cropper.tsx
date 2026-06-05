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
  /** Returns a freshly-generated JPEG blob of the cropped region. */
  onConfirm: (blob: Blob) => void | Promise<void>;
};

export function ImageCropper({ src, aspect = 1, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);
  const [useNativeAspect, setUseNativeAspect] = useState(false);

  useEffect(() => {
    setUseNativeAspect(false);
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

  const nativeAspect =
    nativeSize && nativeSize.w > 0 && nativeSize.h > 0 ? nativeSize.w / nativeSize.h : null;

  const cropAspect = useNativeAspect && nativeAspect != null && Number.isFinite(nativeAspect)
    ? nativeAspect
    : aspect;

  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
  }, [cropAspect]);

  const onCropComplete = useCallback((_: Area, ap: Area) => {
    setAreaPixels(ap);
  }, []);

  async function handleConfirm() {
    if (!areaPixels) return;
    setWorking(true);
    try {
      const blob = await cropToBlob(src, areaPixels);
      await onConfirm(blob);
    } finally {
      setWorking(false);
    }
  }

  const frameStyle =
    useNativeAspect && nativeSize
      ? ({ aspectRatio: `${nativeSize.w} / ${nativeSize.h}` } as const)
      : ({ aspectRatio: "1 / 1" } as const);

  return (
    <div className="space-y-4">
      <div
        className="relative w-full max-h-[min(70vh,880px)] mx-auto rounded-2xl overflow-hidden bg-ink/90"
        style={frameStyle}
      >
        <Cropper
          key={`${src}-${cropAspect}`}
          image={src}
          crop={crop}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          aspect={cropAspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          restrictPosition={false}
          objectFit="contain"
        />
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 accent-ink"
          checked={useNativeAspect}
          disabled={!nativeSize}
          onChange={(e) => setUseNativeAspect(e.target.checked)}
        />
        <span>
          <span className="text-ink">Use photo’s native aspect</span>
          <span className="block text-[11px] text-ink-muted mt-0.5">
            Frame matches the image dimensions instead of a square. Turn off for a 1:1 crop (closet
            tiles).
          </span>
        </span>
      </label>

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

      <p className="text-xs text-ink-muted">
        Drag to reposition. Zoom out past 1× if you need more room to center the subject; empty
        margins export as white.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={working || !areaPixels}
          className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {working ? "Cropping…" : "Use this crop"}
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
