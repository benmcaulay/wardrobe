"use client";

/**
 * Browse photos of one person and hand-pick the ones worth cataloguing.
 *
 * The OS file picker cannot do this. Its Photos source is a flat file view, and
 * the People index is face clusters in Photos.sqlite with no file
 * representation — so "import my clothes" meant scrolling ten thousand
 * undifferentiated photos. Apple has already clustered and named every face;
 * this reads that answer instead of deriving its own.
 *
 * The division of labour is deliberate. Apple decides *whose* photo it is,
 * which it does better than any model shipped here and with no biometric
 * processing by this app. The user decides whether the garment is actually
 * catalogueable, which is the judgement no automatic quality gate makes well.
 * Only what survives both costs a credit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageCropper } from "@/components/image-cropper";
import type { Owner } from "@/lib/json";
import { DEFAULT_OWNERS } from "@/lib/owners";
import { MAX_SCAN_PHOTOS } from "@/lib/camera-roll-scan-limits";
import type { LibraryPerson, LibraryPhoto } from "@/lib/server/photos-library";
import {
  getPhotosLibraryStatus,
  importSelectedPhotos,
  loadPersonPhotos,
} from "@/lib/actions/photos-picker";

type Selection = { uuid: string; croppedDataUrl?: string };

export function PhotosPicker({
  owners = DEFAULT_OWNERS,
  onStarted,
}: {
  owners?: Owner[];
  onStarted: (jobId: string) => void;
}) {
  const roster = owners.length > 0 ? owners : DEFAULT_OWNERS;
  const [status, setStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [error, setError] = useState<string | null>(null);
  const [persons, setPersons] = useState<LibraryPerson[]>([]);
  const [person, setPerson] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>(roster[0]?.id ?? "me");
  const [fromDate, setFromDate] = useState("");
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Map<string, Selection>>(() => new Map());
  const [cropping, setCropping] = useState<LibraryPhoto | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await getPhotosLibraryStatus();
      if (!res.ok) {
        setStatus("unavailable");
        setError(res.error);
        return;
      }
      setStatus("ready");
      setPersons(res.persons);
      // Most-photographed person first is nearly always the owner of the closet.
      if (res.persons[0]) setPerson(res.persons[0].name);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!person) return;
    setLoading(true);
    setError(null);
    try {
      const res = await loadPersonPhotos({ persons: [person], fromDate: fromDate || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhotos(res.photos);
      setSelected(new Map());
    } finally {
      setLoading(false);
    }
  }, [person, fromDate]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return photos;
    return photos.filter(
      (p) => p.filename.toLowerCase().includes(q) || (p.date ?? "").toLowerCase().includes(q),
    );
  }, [photos, filter]);

  function toggle(photo: LibraryPhoto) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(photo.uuid)) next.delete(photo.uuid);
      else if (next.size < MAX_SCAN_PHOTOS) next.set(photo.uuid, { uuid: photo.uuid });
      return next;
    });
  }

  async function onCropConfirmed(blob: Blob) {
    const photo = cropping;
    setCropping(null);
    if (!photo) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(photo.uuid, { uuid: photo.uuid, croppedDataUrl: dataUrl });
      return next;
    });
  }

  async function onImport() {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importSelectedPhotos({
        selections: [...selected.values()],
        ownerIds: [ownerId],
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.skipped.length > 0) {
        setError(`Imported ${res.imported}. Skipped: ${res.skipped.slice(0, 3).join("; ")}`);
      }
      onStarted(res.jobId);
    } finally {
      setImporting(false);
    }
  }

  if (status === "checking") {
    return <p className="text-sm text-ink-muted">Checking your Photos library…</p>;
  }

  if (status === "unavailable") {
    return (
      <section className="rounded-2xl border border-ink/10 bg-paper-warm p-5 space-y-2">
        <h2 className="font-serif text-lg">Photos browsing isn&apos;t available here</h2>
        <p className="text-sm text-ink-muted whitespace-pre-line">{error}</p>
        <p className="text-xs text-ink-muted">
          You can still use “Add to closet” to pick files by hand.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-ink/10 bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wide text-ink-muted">Person</span>
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
            >
              {persons.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wide text-ink-muted">Since</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wide text-ink-muted">
              Whose closet
            </span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-sm capitalize focus:border-ink/40 focus:outline-none"
            >
              {roster.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !person}
            className="rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-40"
          >
            {loading ? "Loading…" : "Load my photos"}
          </button>
        </div>

        {photos.length > 0 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by filename or date…"
            className="w-full rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-sm focus:border-ink/40 focus:outline-none"
          />
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      {photos.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              {visible.length} shown · {selected.size} selected
              {selected.size >= MAX_SCAN_PHOTOS ? ` (max ${MAX_SCAN_PHOTOS})` : ""}
            </p>
            <button
              type="button"
              onClick={() => void onImport()}
              disabled={selected.size === 0 || importing}
              className="rounded-full bg-ink px-6 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-40"
            >
              {importing ? "Starting…" : `Select ${selected.size || ""}`.trim()}
            </button>
          </div>

          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {visible.map((photo) => {
              const pick = selected.get(photo.uuid);
              return (
                <li key={photo.uuid} className="relative">
                  <button
                    type="button"
                    onClick={() => toggle(photo)}
                    className={`block w-full overflow-hidden rounded-xl border transition ${
                      pick ? "border-ink ring-2 ring-ink" : "border-ink/10 hover:border-ink/30"
                    }`}
                    title={`${photo.filename}${photo.date ? ` · ${photo.date.slice(0, 10)}` : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/photos-preview/${photo.uuid}`}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full bg-paper-warm object-cover"
                    />
                  </button>
                  {pick && (
                    <button
                      type="button"
                      onClick={() => setCropping(photo)}
                      className="absolute bottom-1 left-1 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] text-paper"
                    >
                      {pick.croppedDataUrl ? "Cropped ✓" : "Crop"}
                    </button>
                  )}
                  {photo.missing && (
                    <span
                      className="absolute right-1 top-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-900"
                      title="Original isn't downloaded from iCloud — it can't be imported"
                    >
                      iCloud
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {cropping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-surface p-4">
            <p className="mb-2 text-sm text-ink-muted">
              Crop to just the person wearing the piece. Skipping the crop uses the whole photo.
            </p>
            <ImageCropper
              src={`/api/photos-preview/${cropping.uuid}`}
              aspect={1}
              onCancel={() => setCropping(null)}
              onConfirm={(blob) => void onCropConfirmed(blob)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
