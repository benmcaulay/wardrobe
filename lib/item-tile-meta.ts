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

/**
 * The same framing as a *suffix*, for elements that already have a transform.
 *
 * Separate from `itemTileImageTransform` because that function's unframed
 * answer is the keyword `none`, which is only legal as an entire transform —
 * appending it to a list of functions invalidates the whole declaration and
 * silently drops the positioning it was appended to. This returns "" instead,
 * so `translate(...) scale(...)${suffix}` is always valid.
 */
export function itemTileTransformSuffix(
  meta: Pick<ItemTileMeta, "thumbZoom" | "mirror"> | null | undefined,
): string {
  if (!meta) return "";
  const t = itemTileImageTransform(meta);
  return t === "none" ? "" : ` ${t}`;
}

/** CSS transform for closet tiles and outfit canvas pieces (matches item editor). */
export function itemTileImageTransform(meta: Pick<ItemTileMeta, "thumbZoom" | "mirror">): string {
  const parts: string[] = [];
  if (meta.thumbZoom !== 1) parts.push(`scale(${meta.thumbZoom})`);
  if (meta.mirror) parts.push("scaleX(-1)");
  return parts.join(" ") || "none";
}
