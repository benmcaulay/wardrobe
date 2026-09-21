/**
 * Render one ghost mannequin on the local Qwen-Image-2.1 and report the cost
 * of doing so in wall-clock time.
 *
 * The interesting question is not "does ComfyUI answer" but "is a local render
 * good enough and fast enough to be worth choosing", so this runs the real
 * provider with the real prompt and writes the result where you can look at it.
 *
 * Run with: pnpm test:qwen-ghost [imagePath] [outFile]
 */
import { writeFile } from "node:fs/promises";
import { prisma } from "../lib/db";
import { getObject, contentTypeFor } from "../lib/storage";
import { comfyHost, comfyReady, qwenEditImage } from "../lib/services/ghost-provider-qwen";
import { buildPrompt, type GhostMannequinCategory } from "../lib/services/ghostMannequin";

async function main() {
  console.log(`comfy ${comfyHost()}`);
  if (!(await comfyReady())) {
    console.log("Not ready: ComfyUI is not running, or the Qwen-Image-2.1 files are missing.");
    process.exitCode = 1;
    return;
  }

  const imagePath =
    process.argv[2] ??
    (
      await prisma.wardrobeItem.findFirst({
        where: { isWishlist: false },
        orderBy: { createdAt: "desc" },
        select: { originalImagePath: true },
      })
    )?.originalImagePath;
  if (!imagePath) throw new Error("No closet photo to render. Pass one as an argument.");

  const buffer = await getObject(imagePath);
  if (!buffer) throw new Error(`Image not found in storage: ${imagePath}`);
  console.log(`image ${imagePath} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);

  // The same prompt the app would send, so this measures the real path.
  // Category shapes the prompt, so it has to match what is being rendered.
  const category = (process.env.QWEN_GHOST_TEST_CATEGORY ?? "lowerbody") as GhostMannequinCategory;
  const prompt = buildPrompt(category, undefined, "default");
  const startedAt = Date.now();
  const out = await qwenEditImage(prompt, [{ buffer, mime: contentTypeFor(imagePath) }]);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  const dest = process.argv[3] ?? "/tmp/qwen-ghost.png";
  await writeFile(dest, out);
  console.log(`render ${seconds}s  ${(out.byteLength / 1024).toFixed(0)} KB -> ${dest}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
