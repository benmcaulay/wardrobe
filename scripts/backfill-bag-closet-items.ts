/**
 * Give bags that predate the closet link a WardrobeItem, once.
 *
 * Bags used to live only in the packing tool. Linking happens on save, so
 * bags added before that change stay invisible in the closet until someone
 * re-saves each one by hand. This does it in bulk.
 *
 * Idempotent: a bag that already has a link, or has no photo (WardrobeItem
 * requires an image), is skipped. Safe to run repeatedly.
 *
 * Run with: pnpm tsx scripts/backfill-bag-closet-items.ts [--apply]
 * Defaults to a dry run, because it writes to the closet the user looks at.
 */
import { prisma } from "../lib/db";
import { encode, parseStylePrefs } from "../lib/json";
import { getCategoriesListFromPrefs } from "../lib/categories";
import { resolveBagCategory } from "../lib/packing/bag-category";
import { getPrimaryOwnerId } from "../lib/owners";

async function main() {
  const apply = process.argv.includes("--apply");

  const bags = await prisma.packingBag.findMany({
    where: { wardrobeItemId: null, imagePath: { not: null } },
    select: { id: true, userId: true, name: true, imagePath: true },
  });

  const skipped = await prisma.packingBag.count({
    where: { wardrobeItemId: null, imagePath: null },
  });

  console.log(`${bags.length} bag(s) to link; ${skipped} skipped for having no photo.`);
  if (bags.length === 0) return;

  const prefsCache = new Map<string, string[]>();
  const ownerCache = new Map<string, string>();

  for (const bag of bags) {
    if (!prefsCache.has(bag.userId)) {
      const dbUser = await prisma.user.findUnique({
        where: { id: bag.userId },
        select: { stylePrefs: true },
      });
      const prefs = parseStylePrefs(dbUser?.stylePrefs);
      prefsCache.set(bag.userId, getCategoriesListFromPrefs(prefs));
      ownerCache.set(bag.userId, getPrimaryOwnerId(prefs));
    }
    const options = prefsCache.get(bag.userId)!;
    const category = resolveBagCategory(options);

    console.log(`  ${apply ? "linking" : "would link"} "${bag.name}" -> ${category}`);
    if (!apply) continue;

    const item = await prisma.wardrobeItem.create({
      data: {
        userId: bag.userId,
        name: bag.name,
        category,
        colors: encode([]),
        styleTags: encode([]),
        season: encode([]),
        owners: encode([ownerCache.get(bag.userId)!]),
        originalImagePath: bag.imagePath!,
      },
      select: { id: true },
    });
    await prisma.packingBag.update({
      where: { id: bag.id },
      data: { wardrobeItemId: item.id },
    });
  }

  console.log(apply ? "Done." : "Dry run — pass --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
