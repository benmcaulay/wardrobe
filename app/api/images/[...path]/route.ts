import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { contentTypeFor, getObject, getSignedReadUrl, safeKey } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const segments = params.path.map((s) => decodeURIComponent(s));
  if (segments.length === 0 || segments[0] !== user.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const key = safeKey(segments.join("/"));
  if (!key) return new NextResponse("Forbidden", { status: 403 });

  const contentType = contentTypeFor(key);
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return new NextResponse("Unsupported type", { status: 415 });
  }

  // On object storage, offload bytes: hand back a short-lived signed URL.
  // Authorization already happened above (the key is scoped to this user), so
  // a user can only ever obtain signed URLs for their own files.
  const signed = await getSignedReadUrl(key, 300);
  if (signed) return NextResponse.redirect(signed, 302);

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(data.length),
    },
  });
}
