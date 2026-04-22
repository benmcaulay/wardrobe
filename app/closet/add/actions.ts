"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveUpload, UploadError } from "@/lib/uploads";
import { encode } from "@/lib/json";

export type AddItemState = {
  error?: string;
};

// MVP server action for step 2 — writes the file and creates a skeleton
// WardrobeItem. Step 4 replaces this with the full analyze-and-confirm flow.
export async function addItemFromUpload(
  _prev: AddItemState,
  formData: FormData,
): Promise<AddItemState> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File)) return { error: "No file provided" };

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }

  const item = await prisma.wardrobeItem.create({
    data: {
      userId: user.id,
      name: "Untitled",
      category: "top",
      colors: encode([]),
      styleTags: encode([]),
      season: encode([]),
      originalImagePath: saved.originalImagePath,
    },
  });

  revalidatePath("/closet");
  redirect(`/closet/${item.id}`);
}
