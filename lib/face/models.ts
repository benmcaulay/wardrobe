/**
 * Where the face model artifacts live.
 *
 * Not under `public/` — these run in the Node job worker, never in a browser,
 * and serving a 38 MB recognizer to the client would be both pointless and the
 * opposite of the "templates never leave the server transiently" posture in
 * docs/CAMERA_ROLL_PERSON_ISOLATION.md §0.
 *
 * Staged by `pnpm face:fetch`, gitignored like `public/models/`.
 */

import fs from "node:fs";
import path from "node:path";

export const FACE_MODEL_DIR = path.join(process.cwd(), ".models", "face");

export const FACE_MODEL_FILES = {
  detector: "yunet.onnx",
  recognizer: "sface.onnx",
} as const;

export function faceModelPath(file: string): string {
  return path.join(FACE_MODEL_DIR, file);
}

/** True when both artifacts are staged, so callers can degrade instead of throwing. */
export function faceModelsAvailable(): boolean {
  return Object.values(FACE_MODEL_FILES).every((f) => {
    try {
      return fs.statSync(faceModelPath(f)).size > 0;
    } catch {
      return false;
    }
  });
}
