import sharp from "sharp";
import { getObject } from "./storage";

/** 64-bit difference hash as a binary string (8×8). */
export async function computeDHash(imageKey: string): Promise<string | null> {
  const buf = await getObject(imageKey);
  if (!buf) return null;

  const { data, info } = await sharp(buf)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  let hash = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * width + x] ?? 0;
      const right = data[y * width + x + 1] ?? 0;
      hash += left < right ? "1" : "0";
    }
  }
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance + Math.abs(a.length - b.length);
}

export function normalizeGarmentTitle(name: string | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when classifier titles are close enough to reinforce visual similarity. */
export function titlesLikelySame(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeGarmentTitle(a);
  const nb = normalizeGarmentTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen < 4) return false;
  let common = 0;
  const wordsA = new Set(na.split(/\s+/));
  for (const w of nb.split(/\s+/)) {
    if (wordsA.has(w)) common += 1;
  }
  return common >= 2;
}

export type VisualSimilarityInput = {
  hashA: string;
  hashB: string;
  nameA?: string;
  nameB?: string;
  categoryA?: string;
  categoryB?: string;
  maxDistance?: number;
};

/** Decide whether two garment photos likely show the same piece. */
export function photosLikelyDuplicate(input: VisualSimilarityInput): boolean {
  const maxDistance = input.maxDistance ?? 14;
  const looseDistance = maxDistance + 10;
  const distance = hammingDistance(input.hashA, input.hashB);
  const sameCategory =
    !!input.categoryA &&
    !!input.categoryB &&
    input.categoryA === input.categoryB &&
    input.categoryA !== "None";
  const similarTitle = titlesLikelySame(input.nameA, input.nameB);

  if (distance <= maxDistance) return true;
  if (distance <= looseDistance && sameCategory && similarTitle) return true;
  if (distance <= looseDistance + 4 && similarTitle) return true;
  return false;
}
