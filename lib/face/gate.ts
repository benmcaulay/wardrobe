/**
 * The Mode B face gate: build a reference set, score a photo, discard the rest.
 *
 * Lifecycle, and the reason it is shaped like this
 * ------------------------------------------------
 * `buildGate` runs once per scan job, embeds the hand-picked reference photos
 * into per-owner centroids, and returns a closure. When the job ends the
 * closure is garbage and every vector with it. Nothing is written to Postgres,
 * S3, or disk at any point — see docs/CAMERA_ROLL_PERSON_ISOLATION.md §0 for
 * why that specific property is load-bearing rather than tidy.
 *
 * What this does and does not claim
 * ---------------------------------
 * It answers "is an enrolled owner the main subject of this photo". It does not
 * identify anyone, name anyone, or build a roster of the people in your life.
 * Faces belonging to non-enrolled people are embedded transiently to be
 * rejected and are never grouped, stored, or shown.
 *
 * Known limitation, stated because it will be the thing users notice: this gate
 * rejects photos where the clothes are clearest. Roughly a third of a camera
 * roll has a detectable face at all, and full-length outfit shots, mirror
 * selfies with the phone raised, and back-turned photos are precisely the
 * high-value garment images with the worst faces. The moment-propagation tier
 * in §5 Phase 4 is the planned fix and is not built.
 */

import { log } from "@/lib/log";
import { getObject } from "@/lib/storage";
import { detectFaces } from "./detect";
import { decodeImage, alignFace, embedAlignedFaces } from "./embed";
import { faceModelsAvailable } from "./models";
import {
  attributeFace,
  attributePhoto,
  buildReferenceSet,
  calibrateThreshold,
  type ReferenceSet,
} from "./reference";

export type ReferenceInput = { ownerId: string; paths: string[] };

export type FaceGateResult = {
  /** Owner whose reference set matched, or null when nobody did. */
  ownerId: string | null;
  similarity: number;
  /** How many faces were found at all, to tell "no face" from "wrong person". */
  faceCount: number;
};

export type FaceGate = {
  /** Owners with a usable reference centroid. */
  enrolled: string[];
  threshold: number;
  evaluate(imagePath: string): Promise<FaceGateResult>;
};

/** Embed every face in one stored image. Returns [] on any failure. */
async function embedStoredImage(imagePath: string) {
  const buffer = await getObject(imagePath);
  if (!buffer) return { faces: [], embeddings: [] as Float32Array[] };
  const faces = await detectFaces(buffer);
  if (faces.length === 0) return { faces, embeddings: [] as Float32Array[] };
  const image = await decodeImage(buffer);
  const embeddings = await embedAlignedFaces(faces.map((f) => alignFace(image, f)));
  return { faces, embeddings };
}

/**
 * Build one owner's centroid from their reference photos.
 *
 * A reference photo is supposed to show *only* that person, so a photo with
 * more than one face is ambiguous and is dropped rather than guessed at — a
 * wrong face here poisons every downstream decision in the scan.
 */
async function buildOwnerReference(input: ReferenceInput): Promise<ReferenceSet | null> {
  const vectors: Float32Array[] = [];
  for (const path of input.paths) {
    try {
      const { faces, embeddings } = await embedStoredImage(path);
      if (faces.length !== 1 || embeddings.length !== 1) {
        log.info("face.reference.skipped", { path, faceCount: faces.length });
        continue;
      }
      vectors.push(embeddings[0]!);
    } catch (err) {
      log.error("face.reference.failed", err, { path });
    }
  }
  return buildReferenceSet(input.ownerId, vectors);
}

/**
 * Prepare the gate for one scan, or null when it cannot run.
 *
 * Returning null (rather than a gate that rejects everything) is deliberate:
 * the caller falls back to Mode A behaviour and imports what the user picked,
 * which is a worse filter but never a silently empty scan.
 */
export async function buildFaceGate(references: readonly ReferenceInput[]): Promise<FaceGate | null> {
  const usable = references.filter((r) => r.ownerId && r.paths.length > 0);
  if (usable.length === 0) return null;

  if (!faceModelsAvailable()) {
    log.error("face.gate.models-missing", new Error("run `pnpm face:fetch`"));
    return null;
  }

  const sets: ReferenceSet[] = [];
  for (const input of usable) {
    const set = await buildOwnerReference(input);
    if (set) sets.push(set);
  }
  if (sets.length === 0) {
    log.error("face.gate.no-references", new Error("no reference photo yielded exactly one face"));
    return null;
  }

  const threshold = calibrateThreshold(sets);
  log.info("face.gate.ready", {
    owners: sets.map((s) => `${s.ownerId}:${s.sampleCount}`).join(","),
    threshold: Number(threshold.toFixed(4)),
  });

  return {
    enrolled: sets.map((s) => s.ownerId),
    threshold,
    async evaluate(imagePath: string): Promise<FaceGateResult> {
      try {
        const { faces, embeddings } = await embedStoredImage(imagePath);
        if (embeddings.length === 0) {
          return { ownerId: null, similarity: 0, faceCount: faces.length };
        }
        const scored = embeddings.map((embedding, i) => ({
          area: faces[i]?.area ?? 0,
          verdict: attributeFace(embedding, sets, threshold),
        }));
        const winner = attributePhoto(scored);
        return {
          ownerId: winner?.ownerId ?? null,
          similarity: winner?.similarity ?? Math.max(...scored.map((s) => s.verdict.similarity)),
          faceCount: faces.length,
        };
      } catch (err) {
        log.error("face.gate.evaluate-failed", err, { imagePath });
        // Fail open. A crashed detector must not silently delete a photo the
        // user chose to import.
        return { ownerId: null, similarity: 0, faceCount: -1 };
      }
    },
  };
}

/** Human-readable skip reason, so review explains itself. */
export function faceSkipReason(result: FaceGateResult): string {
  if (result.faceCount === -1) return "Could not check who is in this photo";
  if (result.faceCount === 0) return "No face visible to match";
  return "Someone else";
}
