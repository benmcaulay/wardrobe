import { prisma } from "@/lib/db";
import { computeDHash, photosLikelyDuplicate } from "@/lib/image-dhash";
import { log } from "@/lib/log";

export type ClosetHashEntry = {
  itemId: string;
  name: string;
  category: string;
  hash: string;
};

/** Perceptual hashes are computed for missing items with this concurrency. */
const HASH_CONCURRENCY = 8;

/**
 * Load perceptual hashes for the user's existing closet, computing (and
 * write-through persisting) any that are missing. The first scan after this
 * ships backfills older items; subsequent scans just read the stored hashes.
 */
export async function loadClosetHashIndex(userId: string): Promise<ClosetHashEntry[]> {
  const items = await prisma.wardrobeItem.findMany({
    where: { userId },
    select: { id: true, name: true, category: true, dHash: true, originalImagePath: true },
  });

  const entries: ClosetHashEntry[] = [];
  const missing: { id: string; name: string; category: string; originalImagePath: string }[] = [];
  for (const it of items) {
    if (it.dHash) {
      entries.push({ itemId: it.id, name: it.name, category: it.category, hash: it.dHash });
    } else {
      missing.push({
        id: it.id,
        name: it.name,
        category: it.category,
        originalImagePath: it.originalImagePath,
      });
    }
  }

  if (missing.length > 0) {
    log.info("scan.closet-index.backfill", { userId, count: missing.length });
    let cursor = 0;
    async function worker() {
      while (cursor < missing.length) {
        const it = missing[cursor++]!;
        const hash = await computeDHash(it.originalImagePath).catch(() => null);
        if (!hash) continue;
        entries.push({ itemId: it.id, name: it.name, category: it.category, hash });
        await prisma.wardrobeItem
          .update({ where: { id: it.id }, data: { dHash: hash } })
          .catch(() => undefined);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(HASH_CONCURRENCY, missing.length) }, () => worker()),
    );
  }

  return entries;
}

/** First closet item that looks like the same garment as `hash`, or null. */
export function findClosetMatch(
  hash: string,
  name: string | undefined,
  category: string | undefined,
  index: ClosetHashEntry[],
): ClosetHashEntry | null {
  for (const entry of index) {
    if (
      photosLikelyDuplicate({
        hashA: hash,
        hashB: entry.hash,
        nameA: name,
        nameB: entry.name,
        categoryA: category,
        categoryB: entry.category,
      })
    ) {
      return entry;
    }
  }
  return null;
}
