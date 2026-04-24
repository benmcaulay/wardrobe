"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

type Props = {
  /** Object URL for the source image. */
  src: string;
  /** Fixed aspect ratio. Default 1 (square) — matches the closet grid tile. */
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

  return (
    <div className="space-y-4">
      <div className="relative w-full rounded-2xl overflow-hidden bg-ink/90 aspect-square">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          restrictPosition
          objectFit="contain"
        />
      </div>

      <label className="block">
        <span className="text-xs uppercase tracking-wide text-ink-muted">Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          aria-label="Zoom"
          className="mt-1 w-full accent-ink"
        />
      </label>

      <p className="text-xs text-ink-muted">
        Drag to reposition, pinch or use the slider to zoom.
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
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
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
