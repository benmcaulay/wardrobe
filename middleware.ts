import { NextResponse, type NextRequest } from "next/server";
import { DEMO_USER_COOKIE, demoModeEnabled } from "@/lib/auth-shared";

const PUBLIC_PATHS = ["/", "/api/demo/enter", "/api/logout"];
const PUBLIC_PREFIXES = [
  "/_next",
  "/api/images",
  "/api/public-image",
  "/api/auth",
  // Stripe calls this server-to-server; it's authenticated by signature, not session.
  "/api/stripe/webhook",
  // Vercel Cron calls this server-to-server with no session. Authenticated by
  // the CRON_SECRET bearer token the route checks itself, which it refuses to
  // run without — see app/api/cron/drain/route.ts.
  "/api/cron/",
  // Interactive UI direction prototypes (no auth; mock data only).
  "/design-lab",
  // Unlisted share links. The token in the URL is the credential — see
  // lib/share/resolve.ts, which is what actually decides what a token may
  // read (thumbnails only, allow-listed by item id).
  "/s/",
  "/api/share/",
];

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
  /*
   * The demo cookie counts as a session only while demo mode is on.
   *
   * It used to count purely by existing. getCurrentUser() checks demo mode
   * before honouring it, so a stale cookie never actually authenticated
   * anyone — but it did get them past this gate and into pages that then
   * failed further in, which reads as a broken app rather than a locked one.
   */
  const hasSession =
    req.cookies.has("__Secure-next-auth.session-token") ||
    req.cookies.has("next-auth.session-token") ||
    (demoModeEnabled() && req.cookies.has(DEMO_USER_COOKIE));
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
