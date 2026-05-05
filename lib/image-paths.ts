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

/** URL to serve an image through the authenticated route. */
export function imageUrl(relativePath: string): string {
  return `/api/images/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Convenience: URL for the thumbnail derived from the original path. */
export function thumbnailUrl(originalPath: string): string {
  return imageUrl(thumbnailPathFor(originalPath));
}
