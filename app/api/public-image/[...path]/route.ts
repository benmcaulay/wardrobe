import { NextResponse, type NextRequest } from "next/server";
import { verifyPublicImageToken } from "@/lib/public-image-url";
import { contentTypeFor, getObject, getSignedReadUrl, safeKey } from "@/lib/storage";

/** SerpAPI Google Lens fetches garment images via this route (signed, no session cookie). */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const exp = req.nextUrl.searchParams.get("exp");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!exp || !sig) return new NextResponse("Bad request", { status: 400 });

  const segments = params.path.map((s) => decodeURIComponent(s));
  if (segments.length < 2) return new NextResponse("Forbidden", { status: 403 });

  const relativePath = segments.join("/");
  if (!verifyPublicImageToken(relativePath, exp, sig)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const key = safeKey(relativePath);
  if (!key) return new NextResponse("Forbidden", { status: 403 });

  const contentType = contentTypeFor(key);
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return new NextResponse("Unsupported type", { status: 415 });
  }

  const signed = await getSignedReadUrl(key, 300);
  if (signed) return NextResponse.redirect(signed, 302);

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
      "Content-Length": String(data.length),
    },
  });
}
