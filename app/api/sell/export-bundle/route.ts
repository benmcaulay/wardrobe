import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { getCurrentUser } from "@/lib/auth";
import {
  appendListingExportToArchiver,
  LISTING_EXPORT_MAX_IDS,
} from "@/lib/sell/listingExportZip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, LISTING_EXPORT_MAX_IDS);
}

async function streamExportZip(userId: string, itemIds: string[]): Promise<Response> {
  if (itemIds.length === 0) {
    return new Response("Select at least one listing to export", { status: 400 });
  }

  const passThrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err: Error) => {
    passThrough.destroy(err);
  });
  archive.pipe(passThrough);

  void appendListingExportToArchiver(archive, userId, itemIds)
    .then(() => archive.finalize())
    .catch((err: unknown) => {
      archive.abort();
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    });

  const webStream = Readable.toWeb(passThrough) as ReadableStream<Uint8Array>;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename =
    itemIds.length === 1
      ? `listing-export-${stamp}.zip`
      : `listings-export-${itemIds.length}-${stamp}.zip`;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Download a zip of listing.txt + photos for one or more for-sale items. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const itemIds = parseIds(url.searchParams.get("ids"));
  return streamExportZip(user.id, itemIds);
}

/** Same as GET; accepts JSON `{ itemIds: string[] }` for long selections. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let itemIds: string[] = [];
  try {
    const body = (await req.json()) as { itemIds?: unknown; ids?: unknown };
    const raw = body.itemIds ?? body.ids;
    if (Array.isArray(raw)) {
      itemIds = raw.map(String).map((s) => s.trim()).filter(Boolean).slice(0, LISTING_EXPORT_MAX_IDS);
    }
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  return streamExportZip(user.id, itemIds);
}
