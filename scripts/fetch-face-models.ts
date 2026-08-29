/**
 * Stage the Mode B face models into `.models/face/`.
 *
 *   pnpm face:fetch
 *
 * Both are commercially licensed, which is the whole reason they are the ones
 * here — see docs/CAMERA_ROLL_PERSON_ISOLATION.md §0. InsightFace's `buffalo_l`
 * would be more accurate and is research-only.
 *
 *   YuNet  (MIT)        232 KB   face detection + 5 landmarks
 *   SFace  (Apache-2.0)  38 MB   128-d recognition embedding
 *
 * opencv_zoo stores these in git-lfs, so the raw.githubusercontent URL returns
 * a ~130-byte pointer file rather than the model. `media.githubusercontent.com`
 * serves the real object. Downloading the pointer by mistake fails later and
 * confusingly, at session creation, so the size and digest are verified here.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FACE_MODEL_DIR } from "../lib/face/models";

const LFS_BASE = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models";

type Artifact = {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
};

const ARTIFACTS: Artifact[] = [
  {
    file: "yunet.onnx",
    url: `${LFS_BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
    bytes: 232589,
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
  },
  {
    file: "sface.onnx",
    url: `${LFS_BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
    bytes: 38696353,
    sha256: "71500723076fbbd0bdb727816d9e8332151d5fae8a87d272fbf797da27823cbd",
  },
];

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function alreadyStaged(target: string, artifact: Artifact): Promise<boolean> {
  try {
    const existing = await fs.readFile(target);
    return existing.length === artifact.bytes && sha256(existing) === artifact.sha256;
  } catch {
    return false;
  }
}

async function stage(artifact: Artifact): Promise<void> {
  const target = path.join(FACE_MODEL_DIR, artifact.file);
  if (await alreadyStaged(target, artifact)) {
    console.log(`  cached  ${artifact.file}`);
    return;
  }

  const res = await fetch(artifact.url);
  if (!res.ok) throw new Error(`${artifact.file}: HTTP ${res.status} from ${artifact.url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // A git-lfs pointer is valid UTF-8 starting with a version line; the model is
  // not. Checking this explicitly turns a baffling ONNX parse error into a
  // sentence that says what happened.
  if (buf.length < 1024 && buf.subarray(0, 8).toString("utf8").startsWith("version ")) {
    throw new Error(
      `${artifact.file}: got a git-lfs pointer, not the model. The LFS media host may have changed.`,
    );
  }
  if (buf.length !== artifact.bytes) {
    throw new Error(`${artifact.file}: expected ${artifact.bytes} bytes, got ${buf.length}`);
  }
  const digest = sha256(buf);
  if (digest !== artifact.sha256) {
    throw new Error(`${artifact.file}: sha256 mismatch\n  expected ${artifact.sha256}\n  got      ${digest}`);
  }

  await fs.writeFile(target, buf);
  console.log(`  fetched ${artifact.file} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  await fs.mkdir(FACE_MODEL_DIR, { recursive: true });
  console.log(`Staging face models → ${path.relative(process.cwd(), FACE_MODEL_DIR)}`);
  for (const artifact of ARTIFACTS) await stage(artifact);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
