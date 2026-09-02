/**
 * Serve one Photos-library thumbnail to the in-app picker.
 *
 * Reads Apple's already-generated preview in place — nothing is exported or
 * copied, so browsing 1800 photos costs no disk and no time.
 *
 * The path never comes from the client. A uuid is looked up in the index this
 * user built (`cacheIndex`), and only a path that index already contains is
 * eligible; the library-containment check is a second gate on top. Accepting a
 * path parameter here would be an arbitrary-file-read against the server.
 */

import fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isInsidePhotosLibrary, lookupIndexed } from "@/lib/server/photos-library";

const ALLOWED = new Set([".jpeg", ".jpg", ".png", ".heic"]);

function contentTypeFor(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: { uuid: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const photo = lookupIndexed(user.id, params.uuid);
  if (!photo) return new NextResponse("Not indexed", { status: 404 });

  const source = photo.derivative ?? photo.path;
  if (!source) return new NextResponse("No preview available", { status: 404 });
  if (!isInsidePhotosLibrary(source)) return new NextResponse("Forbidden", { status: 403 });

  const ext = source.slice(source.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.has(ext)) return new NextResponse("Unsupported type", { status: 415 });

  // A HEIC derivative would need transcoding and no browser will render it;
  // treat it as absent so the tile shows "no preview" rather than a broken img.
  const contentType = contentTypeFor(source);
  if (!contentType) return new NextResponse("No renderable preview", { status: 415 });

  try {
    const data = await fs.readFile(source);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        // Private: these are the user's own photos, and the uuid is stable.
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
