/**
 * Pure helpers for working with DB-relative image paths. No Node built-ins so
 * they can be imported from client components without dragging sharp or fs
 * into the browser bundle.
 */

/** Derive the thumbnail path from an original path. Convention: foo.jpg → foo-thumb.jpg. */
export function thumbnailPathFor(originalPath: string): string {
  const slash = originalPath.lastIndexOf("/");
  const filename = slash === -1 ? originalPath : originalPath.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot);
  const base = dot === -1 ? originalPath : originalPath.slice(0, originalPath.length - ext.length);
  return `${base}-thumb${ext}`;
}

/**
 * Derive the transparent-cutout PNG path from a ghost-mannequin JPEG path.
 * Convention: foo.jpg → foo-cutout.png. The cutout is produced as a side
 * effect of ghost generation (see whiten-background.ts) so the outfit/try-on
 * features can composite without re-running background removal.
 */
export function cutoutPathFor(ghostPath: string): string {
  const slash = ghostPath.lastIndexOf("/");
  const filename = slash === -1 ? ghostPath : ghostPath.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? ghostPath : ghostPath.slice(0, ghostPath.length - filename.length + dot);
  return `${base}-cutout.png`;
}

/**
 * Derive the full-resolution source path. Convention: foo.jpg -> foo-src.jpg.
 *
 * Garment crops used to be cut from the stored original, which is capped at
 * MAX_EDGE_PX — so a garment filling a quarter of the frame yielded a ~400px
 * crop, and that was what the ghost renderer got. This sibling holds the
 * near-native upload just long enough for the scan to crop from it, then the
 * scan deletes it. Nothing outside the scan should read it, and its absence is
 * always safe: callers fall back to the stored original.
 */
export function sourcePathFor(originalPath: string): string {
  const dot = originalPath.lastIndexOf(".");
  const slash = originalPath.lastIndexOf("/");
  if (dot === -1 || dot < slash) return `${originalPath}-src`;
  return `${originalPath.slice(0, dot)}-src${originalPath.slice(dot)}`;
}

/** URL to serve an image through the authenticated route. */
export function imageUrl(relativePath: string): string {
  return `/api/images/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Convenience: URL for the thumbnail derived from the original path. */
export function thumbnailUrl(originalPath: string): string {
  return imageUrl(thumbnailPathFor(originalPath));
}

/** True when the path is a ghost-mannequin render (may have a -cutout.png sibling). */
export function isGhostImagePath(relativePath: string): boolean {
  const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (filename.includes("-thumb") || filename.includes("-cutout") || filename.includes("-src")) return false;
  return /^ghost-[^/]+\.(jpe?g|png)$/i.test(filename);
}
