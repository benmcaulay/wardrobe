import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { verifyPublicImageToken } from "@/lib/public-image-url";
import { resolveUploadPath } from "@/lib/uploads";

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

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

  const absolute = resolveUploadPath(relativePath);
  if (!absolute) return new NextResponse("Forbidden", { status: 403 });

  const ext = path.extname(absolute).toLowerCase();
  const contentType = CONTENT_TYPE[ext];
  if (!contentType) return new NextResponse("Unsupported type", { status: 415 });

  let data: Buffer;
  try {
    data = await fs.readFile(absolute);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
      "Content-Length": String(data.length),
    },
  });
}
