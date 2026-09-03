/**
 * Serve one Photos-library image to the in-app picker.
 *
 * Two sizes, because the grid and the cropper want opposite things:
 *
 *   default     Apple's smallest derivative, read straight off disk. Grid tiles
 *               are ~200px and there are ~1500 of them.
 *   ?size=full  The best source available, for cropping. Cropping a 360px
 *               preview would upload a garment too small to classify, let alone
 *               read a brand off.
 *
 * Nothing is exported or cached to disk; originals are transcoded on demand and
 * only when the cropper actually asks.
 *
 * The path never comes from the client. A uuid is looked up in the index this
 * user built, and only a path that index already contains is eligible; the
 * library-containment check is a second gate. Accepting a path parameter here
 * would be an arbitrary-file-read against the server.
 */

import fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import { isInsidePhotosLibrary, lookupIndexed } from "@/lib/server/photos-library";

/**
 * Long-edge cap for the crop source. Comfortably more detail than the cropper
 * or the classifier can use, and small enough to stay responsive.
 */
const FULL_MAX_EDGE = 2048;

function directContentType(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  return null;
}

function imageResponse(bytes: Buffer, contentType: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      // Private: these are the user's own photos, and the uuid is stable.
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(bytes.length),
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: { uuid: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const photo = lookupIndexed(user.id, params.uuid);
  if (!photo) return new NextResponse("Not indexed", { status: 404 });

  const wantsFull = req.nextUrl.searchParams.get("size") === "full";

  /*
   * Candidates in preference order, tried until one actually reads.
   *
   * Choosing a single source was not enough: iCloud's "Optimise Mac Storage"
   * leaves a `path` in the database pointing at a file no longer on disk, so
   * the original resolves, then throws, and the photo 404s even though a
   * perfectly good derivative sits next to it. Falling through is what makes an
   * optimised photo usable rather than merely visible.
   *
   * For the crop view the original leads, because some photos have only one
   * derivative and it can be as small as 360px.
   */
  const candidates = (
    wantsFull
      ? [photo.path, photo.derivativeFull, photo.derivative]
      : [photo.derivative, photo.derivativeFull, photo.path]
  ).filter((p): p is string => !!p && isInsidePhotosLibrary(p));

  if (candidates.length === 0) return new NextResponse("No preview available", { status: 404 });

  for (const source of candidates) {
    try {
      const direct = directContentType(source);

      // A JPEG/PNG grid tile is streamed as-is; anything else (HEIC originals,
      // which is most of an iPhone library) is transcoded, but only for the
      // crop view, where the extra work buys real resolution.
      if (direct && !wantsFull) {
        return imageResponse(await fs.readFile(source), direct);
      }

      const jpeg = await sharp(source)
        .rotate()
        .resize(FULL_MAX_EDGE, FULL_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      return imageResponse(jpeg, "image/jpeg");
    } catch {
      // Unreadable — fall through to the next candidate.
    }
  }

  return new NextResponse("Could not read that photo", { status: 404 });
}
