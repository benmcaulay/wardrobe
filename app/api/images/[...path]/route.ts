import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveUploadPath } from "@/lib/uploads";

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const segments = params.path.map((s) => decodeURIComponent(s));
  if (segments.length === 0 || segments[0] !== user.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const relativePath = segments.join("/");
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
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(data.length),
    },
  });
}
