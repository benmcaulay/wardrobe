/**
 * Lens 2 — redundancy (docs/OUTFIT_INTELLIGENCE.md §6).
 *
 * "You have four similar white tees." A description with no verb: it names a
 * fact about the closet and stops. Whether four is too many is the user's call,
 * and the copy is written so that the sentence reads the same whether they
 * think it's a problem or not.
 *
 * Pure similarity, which is the one thing embeddings are unambiguously good at
 * — unlike compatibility, where similarity is actively the wrong metric.
 * Clustered *within* a category, because a white tee and white trainers being
 * near each other in embedding space is not redundancy, it's colour.
 */

import { cosineSimilarity } from "@/lib/wear/embedding";

/**
 * How alike two garments must be to count as near-duplicates.
 *
 * Calibrated from `pnpm calibrate:wear-match` on a real closet: distinct items
 * sit at a median cosine of 0.432 and p99 of 0.841, while the genuine
 * near-duplicates found there — two pairs of light-wash baggy jeans, the same
 * shorts in two colours — sit at 0.95+. This threshold picks out that tail
 * rather than the merely-similar.
 */
export const REDUNDANCY_THRESHOLD = 0.93;

/** A cluster is only worth mentioning at three or more. */
export const MIN_CLUSTER_SIZE = 3;

export type RedundancyItem = {
  id: string;
  category: string;
  vector: Float32Array;
};

export type RedundancyCluster = {
  category: string;
  itemIds: string[];
};

/**
 * Group near-duplicates within each category.
 *
 * Single-link agglomeration: an item joins a cluster if it is close to *any*
 * member. That is the right shape for "you own several of these" — a run of
 * five slightly-different black tees is one observation, not four pairs — even
 * though it can chain, which is the usual objection to single link and is
 * harmless when the threshold is this high.
 */
export function findRedundancyClusters(
  items: readonly RedundancyItem[],
): RedundancyCluster[] {
  const byCategory = new Map<string, RedundancyItem[]>();
  for (const item of items) {
    const key = item.category.trim().toLowerCase();
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(item);
    else byCategory.set(key, [item]);
  }

  const clusters: RedundancyCluster[] = [];

  for (const [category, group] of byCategory) {
    if (group.length < MIN_CLUSTER_SIZE) continue;

    const seen = new Set<string>();
    for (const seed of group) {
      if (seen.has(seed.id)) continue;

      // Breadth-first over the similarity graph, so a chain of near-duplicates
      // lands in one cluster rather than several overlapping pairs.
      const members = [seed];
      seen.add(seed.id);
      for (let i = 0; i < members.length; i += 1) {
        for (const candidate of group) {
          if (seen.has(candidate.id)) continue;
          if (cosineSimilarity(members[i].vector, candidate.vector) >= REDUNDANCY_THRESHOLD) {
            seen.add(candidate.id);
            members.push(candidate);
          }
        }
      }

      if (members.length >= MIN_CLUSTER_SIZE) {
        clusters.push({ category, itemIds: members.map((m) => m.id) });
      }
    }
  }

  return clusters.sort((a, b) => b.itemIds.length - a.itemIds.length);
}
