import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { DEMO_USER_COOKIE } from "@/lib/auth";
import { strEnv } from "@/lib/env";

/**
 * Unified sign-out for both session kinds. Lives outside /api/auth/* because
 * the NextAuth catch-all owns that namespace. Revokes the database session
 * row (not just the cookie) so the token is dead server-side too.
 */
export async function POST(request: NextRequest) {
  const sessionToken =
    request.cookies.get("__Secure-next-auth.session-token")?.value ??
    request.cookies.get("next-auth.session-token")?.value;
  if (sessionToken) {
    await prisma.session.deleteMany({ where: { sessionToken } });
  }

  const base = strEnv("NEXT_PUBLIC_APP_URL") ?? new URL(request.url).origin;
  const res = NextResponse.redirect(new URL("/", base), { status: 303 });
  res.cookies.delete(DEMO_USER_COOKIE);
  res.cookies.delete("next-auth.session-token");
  res.cookies.delete("__Secure-next-auth.session-token");
  return res;
}
