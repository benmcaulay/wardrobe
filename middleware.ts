import { NextResponse, type NextRequest } from "next/server";
import { DEMO_USER_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/", "/api/demo/enter"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/images")) {
    return NextResponse.next();
  }
  const uid = req.cookies.get(DEMO_USER_COOKIE)?.value;
  if (!uid) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
