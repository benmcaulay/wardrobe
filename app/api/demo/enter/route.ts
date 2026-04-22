import { NextResponse } from "next/server";
import { getOrCreateDemoUser, DEMO_USER_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getOrCreateDemoUser();
  const photoCount = await prisma.referencePhoto.count({ where: { userId: user.id } });
  const destination = photoCount === 0 ? "/onboarding" : "/closet";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const res = NextResponse.redirect(new URL(destination, base));
  res.cookies.set(DEMO_USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
