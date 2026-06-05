import { PassThrough } from "node:stream";
import { Readable } from "node:stream";
import archiver from "archiver";
import { getCurrentUser } from "@/lib/auth";
import { appendWardrobeBackupToArchiver } from "@/lib/backup/wardrobeZip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const passThrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err: Error) => {
    passThrough.destroy(err);
  });
  archive.pipe(passThrough);

  void appendWardrobeBackupToArchiver(archive, user.id)
    .then(() => archive.finalize())
    .catch((err: unknown) => {
      archive.abort();
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    });

  const webStream = Readable.toWeb(passThrough) as ReadableStream<Uint8Array>;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `wardrobe-backup-${stamp}.zip`;
  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
