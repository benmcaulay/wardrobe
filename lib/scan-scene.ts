/**
 * What a batch of camera-roll photos is *of* — declared by the user before the
 * picker opens (docs/CAMERA_ROLL_PERSON_ISOLATION.md §5, Phase 4 Mode A).
 *
 * This exists because the import path used to throw away exactly the photos
 * that carry ownership. The classifier prompt said "Skip selfies where a person
 * is the subject", so a photo of you wearing a jacket was dropped as "Not
 * clothing" and only flat-lays survived. That is backwards for a camera roll:
 * worn photos are the common case and the only ones that say *whose* clothes
 * these are.
 *
 * Two things follow from asking the user instead of guessing.
 *
 * 1. **No negation in the prompt.** CVPR 2025's NegBench found vision models
 *    handle "do NOT include X" at roughly chance across 79k examples, which is
 *    what "skip selfies" was relying on. The model now always reports the scene
 *    it sees as a positive enum and the decision to drop is made here, in code,
 *    where it is testable.
 * 2. **Identity is positional, never biometric.** When the user declares a worn
 *    batch we anchor on "the main subject" — largest, most central, most in
 *    focus — rather than asking the model who anyone is. Face verification by a
 *    VLM measures ~70% (FaceXBench) against 98%+ for a dedicated recogniser,
 *    and asking a hosted model to identify private individuals is barred by
 *    Google's prohibited-use policy regardless of accuracy.
 */

/** What the user says the batch is. Chosen before the file picker opens. */
export type ScanSceneType = "worn" | "flatlay";

/** What the model reports it actually saw. `other` is the only skip. */
export type ObservedScene = "worn" | "flatlay" | "other";

export const SCAN_SCENE_TYPES: readonly ScanSceneType[] = ["worn", "flatlay"] as const;

export const DEFAULT_SCAN_SCENE: ScanSceneType = "worn";

export function isScanSceneType(value: unknown): value is ScanSceneType {
  return typeof value === "string" && (SCAN_SCENE_TYPES as readonly string[]).includes(value);
}

/** Coerce an untrusted payload/form value, falling back to the default. */
export function parseScanSceneType(value: unknown): ScanSceneType {
  return isScanSceneType(value) ? value : DEFAULT_SCAN_SCENE;
}

export function parseObservedScene(value: unknown): ObservedScene {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "worn" || v === "flatlay" || v === "other") return v;
  // An unparseable scene must not silently become "other" — that would delete
  // the photo. Unknown means "we could not tell", and a garment list is better
  // evidence than a missing enum.
  return "worn";
}

/**
 * Whether to drop a photo given what the user declared and what the model saw.
 *
 * Deliberately permissive in one direction: a flat-lay inside a batch declared
 * "worn" is still a garment the user chose to upload, so it is kept. Only
 * `other` — food, scenery, receipts, screenshots — is dropped, and only when
 * the model also found nothing to catalogue.
 */
export function shouldSkipScene(observed: ObservedScene, garmentCount: number): boolean {
  return observed === "other" || garmentCount === 0;
}

/** Copy for the declaration step, kept next to the type it describes. */
export const SCENE_COPY: Record<
  ScanSceneType,
  { label: string; blurb: string; instruction: string }
> = {
  worn: {
    label: "Photos of someone wearing them",
    blurb: "Outfit shots, mirror selfies, holiday photos — we read the clothes off the person.",
    instruction:
      "Pick photos where the clothes are clearly visible — full-length beats head-and-shoulders, and one person in frame beats a group.",
  },
  flatlay: {
    label: "Photos of the garments themselves",
    blurb: "Flat-lays, hangers, a pile on the bed, a shopping haul.",
    instruction:
      "Pick photos where each piece is clearly separated — overlapping garments are harder to split apart.",
  },
};
