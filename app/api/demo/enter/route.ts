import { NextResponse } from "next/server";
import { getOrCreateDemoUser, DEMO_USER_COOKIE } from "@/lib/auth";

export async function POST() {
  const user = await getOrCreateDemoUser();
  const res = NextResponse.redirect(new URL("/closet", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  res.cookies.set(DEMO_USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
