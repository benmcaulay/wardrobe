"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, DEMO_USER_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UPLOADS_ROOT } from "@/lib/uploads";

/**
 * Dev-only nuke button — deletes everything owned by the current demo user
 * (cascading via Prisma relations), wipes their uploads folder, clears the
 * cookie and sends them back to the landing page.
 */
export async function clearAllData(): Promise<void> {
  const user = await requireUser();
  await prisma.user.delete({ where: { id: user.id } });
  await fs.rm(path.join(UPLOADS_ROOT, user.id), { recursive: true, force: true });
  cookies().delete(DEMO_USER_COOKIE);
  redirect("/");
}
