"use client";

/**
 * Resolve an item's image to a transparent cut-out, once.
 *
 * Pack mode floats twenty garments around a bag; every one of them arrives as a
 * JPEG on a white or black studio backdrop, and a rectangle of backdrop hanging
 * in space looks like a bug. `resolveOutfitPieceDisplayUrl` already knows how to
 * get a transparent version — preferring the pre-rendered `-cutout.png` and
 * falling back to doing it in a canvas — so this is only the React and caching
 * around it.
 *
 * The cache matters more than it looks. Without it every re-render of the orbit
 * would decode and re-process the same images, and each pass would mint a new
 * blob URL that nothing revokes. Keyed by source path and shared across the
 * module, so an item that moves between bags is processed once per session.
 */

import { useEffect, useState } from "react";
import { resolveOutfitPieceDisplayUrl } from "@/lib/outfit-piece-image";

/** Resolved URLs, keyed by the item's stored relative path. */
const cache = new Map<string, string>();
/** In-flight work, so N components asking at once share one canvas pass. */
const pending = new Map<string, Promise<string>>();

function resolve(relativePath: string): Promise<string> {
  const cached = cache.get(relativePath);
  if (cached) return Promise.resolve(cached);

  const existing = pending.get(relativePath);
  if (existing) return existing;

  // Orbiting items render at 56px; processing the full-size photo for that
  // would be twenty multi-megapixel flood fills on open.
  const work = resolveOutfitPieceDisplayUrl(relativePath, { preferThumbnail: true })
    .catch(() => "")
    .then((url) => {
      const resolved = url || "";
      if (resolved) cache.set(relativePath, resolved);
      pending.delete(relativePath);
      return resolved;
    });

  pending.set(relativePath, work);
  return work;
}

/**
 * The cut-out URL for a path, or null until it's ready.
 *
 * Null rather than the original URL on purpose: showing the backdropped photo
 * for a frame and then swapping it produces a visible flash of white squares
 * every time Pack mode opens. Callers render nothing, or a placeholder, until
 * this resolves.
 */
export function useCutout(relativePath: string | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    relativePath ? cache.get(relativePath) ?? null : null,
  );

  useEffect(() => {
    if (!relativePath) {
      setUrl(null);
      return;
    }
    const hit = cache.get(relativePath);
    if (hit) {
      setUrl(hit);
      return;
    }

    let live = true;
    setUrl(null);
    void resolve(relativePath).then((resolved) => {
      if (live && resolved) setUrl(resolved);
    });
    return () => {
      live = false;
    };
  }, [relativePath]);

  return url;
}
