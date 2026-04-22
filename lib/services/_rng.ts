import { createHash } from "node:crypto";

/**
 * Deterministic helpers used by every stub service so the same input always
 * produces the same fake result during development. When a stub is replaced
 * by a real API, these helpers go away along with it.
 */

export function seedFromString(s: string): number {
  const digest = createHash("sha256").update(s).digest();
  return digest.readUInt32BE(0);
}

/** Mulberry32 — small, fast, and good enough for picking fake data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(s: string): () => number {
  return mulberry32(seedFromString(s));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN<T>(rng: () => number, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  const take = Math.min(n, copy.length);
  for (let i = 0; i < take; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export function range(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
