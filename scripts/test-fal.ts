import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import path from "node:path";
import { createGhostMannequin } from "../lib/services/ghostMannequin";

async function main() {
  console.log("USE_REAL_GHOST_MANNEQUIN =", process.env.USE_REAL_GHOST_MANNEQUIN);
  console.log("FAL_KEY length =", process.env.FAL_KEY?.length ?? 0);

  const p = new PrismaClient();
  const item = await p.wardrobeItem.findFirst();
  if (!item) {
    console.error("Seed the DB first.");
    process.exit(1);
  }

  const t0 = Date.now();
  try {
    const r = await createGhostMannequin({
      userId: item.userId,
      garmentImagePath: item.originalImagePath,
      category: "upperbody",
    });
    const meta = await sharp(path.join(process.cwd(), "uploads", r.resultImagePath)).metadata();
    console.log("OK in", Date.now() - t0, "ms");
    console.log("  resultImagePath:", r.resultImagePath);
    console.log("  dimensions:", meta.width + "x" + meta.height, meta.format);
  } catch (e) {
    console.error("FAIL after", Date.now() - t0, "ms:", (e as Error).message);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();
