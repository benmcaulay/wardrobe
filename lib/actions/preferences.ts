"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode, type StylePrefs } from "@/lib/json";

export async function updateStylePrefs(prefs: StylePrefs): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(prefs) },
  });
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}

export async function finishOnboarding(prefs: StylePrefs): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(prefs) },
  });
  revalidatePath("/closet");
  redirect("/closet");
}
