import crypto from "node:crypto";
import { computeDHash, garmentsLikelyDuplicate } from "@/lib/image-dhash";
import type { CameraRollScanItemResult } from "@/lib/jobs/queue";

type ReadyItem = CameraRollScanItemResult & { status: "ready" };

function isReady(item: CameraRollScanItemResult): item is ReadyItem {
  return item.status === "ready";
}

/**
 * Cluster likely duplicate garment photos (same piece, multiple angles) by
 * garment signature (category + colors + pattern) or a near-identical frame.
 * Whole-photo hashing alone over-merges wearing-shots (same pose, different
 * clothes), so attributes are the primary signal. Groups of size ≥ 2 share an id.
 */
export async function assignDuplicateGroups(
  items: CameraRollScanItemResult[],
): Promise<CameraRollScanItemResult[]> {
  const ready = items.filter(isReady);
  if (ready.length < 2) return items;

  const hashes = new Map<string, string>();
  for (const item of ready) {
    const hash = await computeDHash(item.originalImagePath);
    if (hash) hashes.set(item.reviewId, hash);
  }

  const parent = new Map<string, string>();
  function find(id: string): string {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }
  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }

  for (const item of ready) parent.set(item.reviewId, item.reviewId);

  for (let i = 0; i < ready.length; i++) {
    const a = ready[i]!;
    const hashA = hashes.get(a.reviewId);
    if (!hashA) continue;
    for (let j = i + 1; j < ready.length; j++) {
      const b = ready[j]!;
      const hashB = hashes.get(b.reviewId);
      if (!hashB) continue;
      if (
        garmentsLikelyDuplicate(
          { hash: hashA, category: a.category, colors: a.colors, pattern: a.pattern },
          { hash: hashB, category: b.category, colors: b.colors, pattern: b.pattern },
        )
      ) {
        union(a.reviewId, b.reviewId);
      }
    }
  }

  const clusters = new Map<string, ReadyItem[]>();
  for (const item of ready) {
    const root = find(item.reviewId);
    const list = clusters.get(root) ?? [];
    list.push(item);
    clusters.set(root, list);
  }

  const groupIdByReview = new Map<string, string>();
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const groupId = crypto.randomUUID();
    for (const item of cluster) groupIdByReview.set(item.reviewId, groupId);
  }

  if (groupIdByReview.size === 0) return items;

  return items.map((item) => {
    const duplicateGroupId = groupIdByReview.get(item.reviewId);
    if (!duplicateGroupId) return item;
    return { ...item, duplicateGroupId };
  });
}
