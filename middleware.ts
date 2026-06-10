import { NextResponse, type NextRequest } from "next/server";
import { DEMO_USER_COOKIE } from "@/lib/auth-shared";

const PUBLIC_PATHS = ["/", "/api/demo/enter", "/api/logout"];
const PUBLIC_PREFIXES = ["/_next", "/api/images", "/api/public-image", "/api/auth"];

/**
 * Cheap redirect-to-landing for signed-out visitors. This is UX, not the
 * security boundary — every server action and route handler re-checks the
 * session via requireUser()/getCurrentUser() (the edge runtime can't do the
 * DB lookup a real check needs).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const hasSession =
    req.cookies.has("__Secure-next-auth.session-token") ||
    req.cookies.has("next-auth.session-token") ||
    req.cookies.has(DEMO_USER_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
