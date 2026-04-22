"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";

export type RefPhotoResult =
  | { ok: true; added: number }
  | { ok: false; error: string };

/**
 * Accepts one or more files under the "photos" field. Each is resized and
 * stored under uploads/{userId}/. If the user has no primary photo yet, the
 * first newly-added photo becomes primary.
 */
export async function addReferencePhotos(formData: FormData): Promise<RefPhotoResult> {
  const user = await requireUser();
  const files = formData.getAll("photos").filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length === 0) return { ok: false, error: "No photos provided" };

  const hasPrimary = (await prisma.referencePhoto.count({ where: { userId: user.id, isPrimary: true } })) > 0;

  let added = 0;
  for (const file of files) {
    try {
      const saved = await saveUpload(file, user.id);
      await prisma.referencePhoto.create({
        data: {
          userId: user.id,
          imagePath: saved.originalImagePath,
          isPrimary: !hasPrimary && added === 0,
        },
      });
      added++;
    } catch (err) {
      revalidatePath("/onboarding");
      revalidatePath("/settings");
      if (err instanceof UploadError) return { ok: false, error: err.message };
      throw err;
    }
  }

  revalidatePath("/onboarding");
  revalidatePath("/settings");
  return { ok: true, added };
}

export async function setPrimaryReferencePhoto(photoId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.referencePhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.userId !== user.id) return;
  await prisma.$transaction([
    prisma.referencePhoto.updateMany({ where: { userId: user.id }, data: { isPrimary: false } }),
    prisma.referencePhoto.update({ where: { id: photoId }, data: { isPrimary: true } }),
  ]);
  revalidatePath("/onboarding");
  revalidatePath("/settings");
}

export async function deleteReferencePhoto(photoId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.referencePhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.userId !== user.id) return;
  await deleteUpload(photo.imagePath);
  await prisma.referencePhoto.delete({ where: { id: photoId } });

  // If we just deleted the primary, promote the most recent remaining photo.
  if (photo.isPrimary) {
    const next = await prisma.referencePhoto.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    if (next) {
      await prisma.referencePhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  }

  revalidatePath("/onboarding");
  revalidatePath("/settings");
  revalidatePath("/try-on", "layout");
}
