/**
 * Live smoke test for the camera-roll scan classifier. Runs real garment images
 * through detectGarmentsInPhoto (the exact scan path) and prints the structured
 * result — category, name, colors, pattern, material. Spends a little fal credit.
 *
 *   node --env-file=.env --import tsx scripts/scan-smoke.ts <imageKey> [imageKey...]
 */
import { detectGarmentsInPhoto } from "../lib/services/garmentClassifier";

async function main() {
  const keys = process.argv.slice(2);
  if (keys.length === 0) {
    console.error("Usage: scan-smoke.ts <imageKey> [imageKey...]");
    process.exit(1);
  }

  for (const key of keys) {
    const started = Date.now();
    try {
      const result = await detectGarmentsInPhoto(key);
      console.log(`■ ${key}  (${Date.now() - started}ms)`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.log(`■ ${key}  FAILED: ${(err as Error).message}`);
    }
    console.log("");
  }
}

void main();
