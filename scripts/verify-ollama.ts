/**
 * Check that the local vision model can actually do the classifier's job.
 *
 * Reachability and "the model is pulled" are easy to confirm and not the
 * interesting question — a 4B model will happily answer and get the garment
 * wrong. So this runs the real classifier prompt against a real photo from the
 * closet and prints what came back, next to how long it took.
 *
 * Run with: pnpm test:ollama [imagePath]
 */
import { prisma } from "../lib/db";
import { getObject, contentTypeFor } from "../lib/storage";
import { ollamaHost, ollamaReady, ollamaText, ollamaVisionModel } from "../lib/services/ollama-text";
import { detectGarmentsInPhoto } from "../lib/services/garmentClassifier";

async function main() {
  const model = ollamaVisionModel();
  console.log(`host  ${ollamaHost()}`);
  console.log(`model ${model}`);

  if (!(await ollamaReady(model))) {
    console.log(`\nNot ready: either Ollama is not running, or ${model} is not pulled.`);
    console.log(`Pull it with:  ollama pull ${model}`);
    process.exitCode = 1;
    return;
  }

  const textStarted = Date.now();
  const reply = await ollamaText('Reply with {"ok":true} and nothing else.');
  console.log(`\ntext  ${Date.now() - textStarted}ms  ${reply.trim().slice(0, 80)}`);

  const imagePath =
    process.argv[2] ??
    (
      await prisma.wardrobeItem.findFirst({
        where: { isWishlist: false },
        orderBy: { createdAt: "desc" },
        select: { originalImagePath: true },
      })
    )?.originalImagePath;

  if (!imagePath) {
    console.log("\nNo closet photo to test vision with. Pass one as an argument.");
    return;
  }
  if (!(await getObject(imagePath))) {
    console.log(`\nImage not found in storage: ${imagePath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nimage ${imagePath} (${contentTypeFor(imagePath)})`);

  // Through the classifier rather than a hand-written prompt: the point is
  // whether the real path works, not whether the model can see a picture.
  const visionStarted = Date.now();
  const detection = await detectGarmentsInPhoto(imagePath);
  const ms = Date.now() - visionStarted;

  console.log(`vision ${ms}ms  isGarment=${detection.isGarment}`);
  for (const g of detection.garments) {
    const colors = (g.colors ?? []).map((c) => c.name).join("/") || "—";
    console.log(`  ${g.category} · ${g.name} · ${colors} · confidence ${g.confidence}`);
  }
  if (detection.skipReason) console.log(`  skipped: ${detection.skipReason}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
