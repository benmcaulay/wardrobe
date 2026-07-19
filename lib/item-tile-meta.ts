/** Thumbnail framing stored on wardrobe items (closet grid + outfit canvas). */
export type ItemTileMeta = {
  mirror: boolean;
  thumbZoom: number;
};

export function readPrimaryGhostTileMeta(
  ghostViewsRaw: string | null,
  ghostImagePath: string | null,
): ItemTileMeta {
  if (!ghostViewsRaw || !ghostImagePath) return { mirror: false, thumbZoom: 1 };
  try {
    const parsed = JSON.parse(ghostViewsRaw) as Array<{
      imagePath?: string;
      mirror?: boolean;
      thumbZoom?: number;
    }>;
    const primary = parsed.find((v) => v.imagePath === ghostImagePath);
    if (!primary) return { mirror: false, thumbZoom: 1 };
    return {
      mirror: !!primary.mirror,
      thumbZoom: typeof primary.thumbZoom === "number" ? primary.thumbZoom : 1,
    };
  } catch {
    return { mirror: false, thumbZoom: 1 };
  }
}

export function readItemTileMeta(item: {
  ghostViews: string | null;
  ghostImagePath: string | null;
  originalMirror: boolean | null;
  originalThumbZoom: number | null;
}): ItemTileMeta {
  if (item.ghostImagePath) {
    return readPrimaryGhostTileMeta(item.ghostViews, item.ghostImagePath);
  }
  return {
    mirror: item.originalMirror ?? false,
    thumbZoom: item.originalThumbZoom ?? 1,
  };
}

/** CSS transform for closet tiles and outfit canvas pieces (matches item editor). */
export function itemTileImageTransform(meta: Pick<ItemTileMeta, "thumbZoom" | "mirror">): string {
  const parts: string[] = [];
  if (meta.thumbZoom !== 1) parts.push(`scale(${meta.thumbZoom})`);
  if (meta.mirror) parts.push("scaleX(-1)");
  return parts.join(" ") || "none";
}
