"use server";

/**
 * Server actions behind the in-app Photos picker.
 *
 * The picker replaces only the *source* of photos. Once a selection is
 * uploaded it enters the existing `camera_roll_scan` job unchanged, so
 * classification, review, dedupe and deferred ghosting all behave exactly as
 * they do for the OS file picker.
 */

import { readFile } from "node:fs/promises";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { getOwnersFromPrefs, getPrimaryOwnerId, sanitizeOwnerIds } from "@/lib/owners";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJobDrain } from "@/lib/jobs/kick-drain";
import { MAX_SCAN_PHOTOS } from "@/lib/camera-roll-scan-limits";
import { saveImageBuffer } from "@/lib/uploads";
import {
  cacheIndex,
  listPersons,
  lookupIndexed,
  photosAvailable,
  PhotosPermissionError,
  queryPersonPhotos,
  type LibraryPerson,
  type LibraryPhoto,
} from "@/lib/server/photos-library";

export type PhotosAvailability = { ok: true; persons: LibraryPerson[] } | { ok: false; error: string };

/** Whether this machine can browse Photos at all, plus the named people in it. */
export async function getPhotosLibraryStatus(): Promise<PhotosAvailability> {
  await requireUser();
  if (!photosAvailable()) {
    return {
      ok: false,
      error:
        "Browsing your Photos library needs osxphotos on this machine. " +
        "Install it with: brew tap RhetTbull/osxphotos && brew install osxphotos",
    };
  }
  try {
    return { ok: true, persons: listPersons() };
  } catch (err) {
    if (err instanceof PhotosPermissionError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Could not read Photos" };
  }
}

export type LoadPhotosResponse =
  | { ok: true; photos: LibraryPhoto[] }
  | { ok: false; error: string };

export async function loadPersonPhotos(input: {
  persons: string[];
  fromDate?: string;
  toDate?: string;
}): Promise<LoadPhotosResponse> {
  const user = await requireUser();
  if (!photosAvailable()) return { ok: false, error: "osxphotos is not installed" };
  if (input.persons.length === 0) return { ok: false, error: "Pick a person first" };

  try {
    const photos = queryPersonPhotos({
      persons: input.persons,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
    // Cached so the preview route can resolve a uuid without re-reading the
    // whole Photos database per thumbnail.
    cacheIndex(user.id, photos);
    return { ok: true, photos };
  } catch (err) {
    if (err instanceof PhotosPermissionError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Could not read Photos" };
  }
}

export type ImportSelectionResponse =
  | { ok: true; jobId: string; imported: number; skipped: string[] }
  | { ok: false; error: string };

/**
 * Upload a hand-picked selection and hand it to the normal scan job.
 *
 * `croppedDataUrl` carries a crop the user made in the grid. When present it
 * *is* the image — the original is never uploaded, so a photo cropped to one
 * person never sends the rest of the frame to Gemini.
 */
export async function importSelectedPhotos(input: {
  selections: { uuid: string; croppedDataUrl?: string }[];
  ownerIds?: string[];
}): Promise<ImportSelectionResponse> {
  const user = await requireUser();
  const selections = input.selections.slice(0, MAX_SCAN_PHOTOS);
  if (selections.length === 0) return { ok: false, error: "Nothing selected" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const ownerIds = sanitizeOwnerIds(
    input.ownerIds ?? [],
    getOwnersFromPrefs(prefs).map((o) => o.id),
    [getPrimaryOwnerId(prefs)],
  );

  const photoPaths: string[] = [];
  /** Storage keys the user framed by hand, so the bbox call can be skipped. */
  const manualCropPaths: string[] = [];
  const skipped: string[] = [];

  for (const selection of selections) {
    const photo = lookupIndexed(user.id, selection.uuid);
    if (!photo) {
      skipped.push(`${selection.uuid}: no longer indexed`);
      continue;
    }
    try {
      if (selection.croppedDataUrl) {
        const base64 = selection.croppedDataUrl.split(",")[1] ?? "";
        const saved = await saveImageBuffer(Buffer.from(base64, "base64"), user.id);
        photoPaths.push(saved.originalImagePath);
        manualCropPaths.push(saved.originalImagePath);
      } else {
        /*
         * Prefer the original, fall back to the full-size derivative.
         *
         * iCloud's "Optimise Mac Storage" removes originals but leaves Apple's
         * large preview behind, and that preview is easily good enough to
         * catalogue a garment from. Refusing those photos would have made most
         * of a real library unimportable for no benefit.
         */
        const source = photo.path ?? photo.derivativeFull ?? photo.derivative;
        if (!source) {
          skipped.push(`${photo.filename}: no image available locally`);
          continue;
        }
        const bytes = await readFile(source);
        const saved = await saveImageBuffer(bytes, user.id);
        photoPaths.push(saved.originalImagePath);
      }
    } catch (err) {
      skipped.push(`${photo.filename}: ${err instanceof Error ? err.message : "upload failed"}`);
    }
  }

  if (photoPaths.length === 0) {
    return { ok: false, error: skipped[0] ?? "Nothing could be imported" };
  }

  const jobId = await enqueueJob(user.id, "camera_roll_scan", {
    photoPaths,
    sceneType: "worn" as const,
    ownerIds,
    // A photo the user framed themselves does not need Gemini asked where the
    // garment is — that call is skipped, which is a real saving per garment.
    manualCropPaths: manualCropPaths.length > 0 ? manualCropPaths : undefined,
  });
  kickJobDrain(photoPaths.length);

  return { ok: true, jobId, imported: photoPaths.length, skipped };
}
