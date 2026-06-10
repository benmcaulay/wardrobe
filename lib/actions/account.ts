"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, DEMO_USER_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";

/**
 * Nuke button — deletes everything owned by the current user (cascading via
 * Prisma relations), wipes their stored files, clears the demo cookie and
 * sends them back to the landing page.
 */
export async function clearAllData(): Promise<void> {
  const user = await requireUser();
  await prisma.user.delete({ where: { id: user.id } });
  await deletePrefix(user.id);
  cookies().delete(DEMO_USER_COOKIE);
  redirect("/");
}
