import { NextResponse } from "next/server";
import { getOrCreateDemoUser, demoModeEnabled, DEMO_USER_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  if (!demoModeEnabled()) {
    return new NextResponse("Demo mode is disabled", { status: 404 });
  }
  const user = await getOrCreateDemoUser();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const res = NextResponse.redirect(new URL("/closet", base));
  res.cookies.set(DEMO_USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
