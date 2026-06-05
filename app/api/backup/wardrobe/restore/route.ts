import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { restoreWardrobeFromZip } from "@/lib/backup/wardrobeRestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 500 * 1024 * 1024; // 500MB — backups with images can be large.

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, error: "No backup file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "Backup is larger than 500MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await restoreWardrobeFromZip(buffer, user.id);

  if (result.ok) {
    revalidatePath("/closet");
  }
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
