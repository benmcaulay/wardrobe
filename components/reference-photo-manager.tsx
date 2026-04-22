"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addReferencePhotos,
  setPrimaryReferencePhoto,
  deleteReferencePhoto,
} from "@/lib/actions/reference-photos";
import { imageUrl } from "@/lib/image-paths";

export type ReferencePhotoListItem = {
  id: string;
  imagePath: string;
  isPrimary: boolean;
};

type Props = {
  photos: ReferencePhotoListItem[];
  /** Max recommended count (soft — we only show the limit in the UI). */
  maxRecommended?: number;
};

export function ReferencePhotoManager({ photos, maxRecommended = 5 }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    for (const f of list) formData.append("photos", f);
    const res = await addReferencePhotos(formData);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  function onPickClick() {
    fileRef.current?.click();
  }

  function onPrimary(id: string) {
    startTransition(async () => {
      await setPrimaryReferencePhoto(id);
      router.refresh();
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      await deleteReferencePhoto(id);
      router.refresh();
    });
  }

  const showSoftHint = photos.length > 0 && photos.length < 3;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragActive ? "border-accent bg-accent-soft/20" : "border-ink/15 bg-paper-warm"
        }`}
      >
        <p className="font-serif text-xl">Drop photos here</p>
        <p className="text-ink-muted text-xs mt-1">
          {photos.length} / {maxRecommended} added · JPG, PNG, WebP up to 10MB each
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
          }}
        />
        <button
          type="button"
          onClick={onPickClick}
          disabled={uploading}
          className="mt-4 rounded-full bg-ink text-paper px-5 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Pick photos"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {showSoftHint && (
        <p className="text-xs text-ink-muted">
          Three or more photos produce better try-on results.
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {photos.map((p) => (
            <li
              key={p.id}
              className={`relative rounded-xl overflow-hidden aspect-[3/4] shadow-tile group ${
                p.isPrimary ? "ring-2 ring-accent" : ""
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(p.imagePath)}
                alt="Reference photo"
                className="w-full h-full object-cover"
              />
              {p.isPrimary && (
                <span className="absolute top-2 left-2 bg-accent text-white text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                  Primary
                </span>
              )}
              <div className="absolute inset-0 flex items-end justify-between p-2 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-ink/70 to-transparent">
                {!p.isPrimary && (
                  <button
                    type="button"
                    onClick={() => onPrimary(p.id)}
                    className="text-[10px] bg-white/90 text-ink rounded-full px-2 py-1 hover:bg-white transition"
                  >
                    Set primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="text-[10px] bg-white/90 text-red-700 rounded-full px-2 py-1 hover:bg-white transition ml-auto"
                  aria-label="Delete photo"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
