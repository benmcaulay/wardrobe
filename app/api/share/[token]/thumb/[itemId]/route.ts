import { NextResponse, type NextRequest } from "next/server";
import { contentTypeFor, getObject, safeKey } from "@/lib/storage";
import { resolveShareThumbnailKey } from "@/lib/share/resolve";

/**
 * Serve one item's thumbnail for a public share.
 *
 * Takes an item id rather than a storage path, so a token can never be used to
 * walk the uploads tree — the resolver maps id → thumbnail key itself and
 * refuses ids outside the share's allow-list. Only the 400px thumbnail is
 * reachable; the full-resolution original has no public route at all.
 *
 * Unlike /api/public-image this does NOT redirect to a signed S3 URL: that URL
 * would outlive a revoke. Bytes are proxied so turning a link off takes effect
 * immediately.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string; itemId: string } },
) {
  const token = decodeURIComponent(params.token ?? "");
  const itemId = decodeURIComponent(params.itemId ?? "");
  if (!token || !itemId) return new NextResponse("Bad request", { status: 400 });

  const relativePath = await resolveShareThumbnailKey(token, itemId);
  if (!relativePath) return new NextResponse("Not found", { status: 404 });

  const key = safeKey(relativePath);
  if (!key) return new NextResponse("Forbidden", { status: 403 });

  const contentType = contentTypeFor(key);
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return new NextResponse("Unsupported type", { status: 415 });
  }

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      // Short cache: long enough to keep a shared page snappy, short enough
      // that a revoke isn't papered over by a CDN.
      "Cache-Control": "public, max-age=300",
      "Content-Length": String(data.length),
    },
  });
}
