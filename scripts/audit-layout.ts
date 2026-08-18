/**
 * Does every page fit its viewport?
 * Run with: pnpm audit:layout [--width 1440] [--widths 1440,1280,1024] [--route /closet]
 *                             (JSON=1 for machine-readable output)
 *
 * ── The question ────────────────────────────────────────────────────────────
 *
 * Two kinds of "row doesn't fit", and they need different detection:
 *
 *   1. Something extends past the viewport edge — catchable by comparing
 *      geometry to the document width.
 *   2. A row wraps inside its own column. A 13-swatch colour palette spilled two
 *      swatches onto a second line inside a 621px column while the 1440px
 *      viewport was perfectly clean, so (1) could never have found it.
 *
 * This checks both, at several widths, against a real logged-in session.
 *
 * ── How it drives the browser ───────────────────────────────────────────────
 *
 * next.config.mjs sets `X-Frame-Options: DENY`, so the pages cannot be measured
 * from an iframe, and evaluating in a tab loses its context on every navigation.
 * So it speaks CDP to a headless Chrome directly. Node 22+ ships a WebSocket
 * client, so there is no dependency to install.
 *
 * lib/eval/layout-rows.ts holds the row-counting logic, pure and unit-tested;
 * the browser only collects rectangles. That split exists because an earlier
 * inline version counted distinct `top` offsets and reported controls of
 * differing heights as wrapped.
 *
 * ── Reading the output ──────────────────────────────────────────────────────
 *
 * `overflow` is a hard failure: something is off-screen. `wrapped` is advisory —
 * a two-column card grid legitimately occupies several rows, so each hit needs a
 * human call on whether that row was meant to be one line. Galleries above
 * GALLERY_CHILD_THRESHOLD children are filtered out already.
 *
 * Exits non-zero when anything overflows the viewport, so it can gate CI.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { findWrappedRows, type Candidate } from "@/lib/eval/layout-rows";

const AS_JSON = process.env.JSON === "1";
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3000";
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT ?? 9333);
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Discover routes from the filesystem rather than a hardcoded list, so a new
 * page is audited the day it lands. Route groups `(x)` contribute no segment.
 */
async function discoverRoutes(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, segs: string[]) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_") || entry.name === "api") continue;
      const next = /^\(.*\)$/.test(entry.name) ? segs : [...segs, entry.name];
      const full = path.join(dir, entry.name);
      try {
        await fs.access(path.join(full, "page.tsx"));
        out.push("/" + next.join("/"));
      } catch {
        /* no page at this level */
      }
      await walk(full, next);
    }
  }
  try {
    await fs.access("app/page.tsx");
    out.push("/");
  } catch {
    /* no root page */
  }
  await walk("app", []);
  return [...new Set(out)].sort();
}

/** Fill `[itemId]`-style segments with something real, or drop the route. */
async function resolveDynamic(routes: string[]): Promise<{ routes: string[]; skipped: string[] }> {
  const dynamic = routes.filter((r) => r.includes("["));
  if (dynamic.length === 0) return { routes, skipped: [] };

  const prisma = new PrismaClient();
  let itemId: string | null = null;
  try {
    itemId = (await prisma.wardrobeItem.findFirst({ select: { id: true } }))?.id ?? null;
  } catch {
    itemId = null;
  } finally {
    await prisma.$disconnect();
  }

  const resolved: string[] = [];
  const skipped: string[] = [];
  for (const r of routes) {
    if (!r.includes("[")) {
      resolved.push(r);
      continue;
    }
    if (itemId && /\[itemId\]/.test(r) && !/\[(?!itemId).*\]/.test(r)) {
      resolved.push(r.replace("[itemId]", itemId));
    } else {
      // No safe stand-in (share tokens, trip ids) — say so rather than reporting
      // a clean pass for a page that was never rendered.
      skipped.push(r);
    }
  }
  return { routes: resolved, skipped };
}

/** Collect geometry in the page. Judgement happens in Node. */
const COLLECT = `(() => {
  const vw = document.documentElement.clientWidth;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };

  const offenders = [];
  const truncated = [];
  const candidates = [];

  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);

    if (cs.position !== "fixed" && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
      // Two different questions, two different ancestor tests:
      //   contained  — any ancestor that clips OR scrolls; the content is either
      //                inside the box or reachable by scrolling, so it is not
      //                off-screen. A horizontal scroller is *supposed* to hold
      //                content wider than itself.
      //   clipper    — the nearest ancestor that clips outright (hidden/clip);
      //                anything spilling that is genuinely unreachable.
      let contained = false;
      let clipper = null;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const clips = /hidden|clip/.test(acs.overflowX) || /hidden|clip/.test(acs.overflow);
        const scrolls = /auto|scroll/.test(acs.overflowX) || /auto|scroll/.test(acs.overflow);
        if (clips && !clipper) clipper = a;
        if (clips || scrolls) { contained = true; break; }
      }
      const describe = () => {
        let sel = el.tagName.toLowerCase();
        if (el.id) sel += "#" + el.id;
        const cls = String(el.className || "").trim().split(/\\s+/).slice(0, 3).join(".");
        if (cls) sel += "." + cls;
        return sel;
      };

      if (!contained && (r.right > vw + 2 || r.left < -2)) {
        offenders.push({ sel: describe(), width: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left) });
      } else if (clipper) {
        // A clipped element is only a defect if something reachable is being cut
        // off. Decorative layers (gradients, vignettes) are deliberately clipped
        // and have no controls or text, so they stay quiet; a row of buttons
        // wider than its card does not.
        const cr = clipper.getBoundingClientRect();
        const spills = r.right > cr.right + 2 || r.left < cr.left - 2;
        if (spills) {
          const interactive = el.matches("button,a,input,select,textarea,label") ||
            el.querySelector("button,a,input,select,textarea,label") !== null;
          const hasText = (el.textContent || "").trim().length > 0;
          if (interactive || hasText) {
            truncated.push({
              sel: describe(),
              width: Math.round(r.width),
              right: Math.round(r.right),
              clipperWidth: Math.round(cr.width),
              clipper: clipper.tagName.toLowerCase() + "." + String(clipper.className || "").trim().split(/\\s+/).slice(0, 2).join("."),
            });
          }
        }
      }
    }

    if (/flex|grid/.test(cs.display) && cs.flexDirection !== "column") {
      const kids = [...el.children].filter((k) => { const kr = k.getBoundingClientRect(); return kr.width > 0 && kr.height > 0; });
      if (kids.length >= 5 && kids.length < 40) {
        const cls = String(el.className || "").trim().split(/\\s+/).slice(0, 3).join(".");
        candidates.push({
          sel: el.tagName.toLowerCase() + (cls ? "." + cls : ""),
          width: r.width,
          kids: kids.map(rect),
          labels: kids.slice(0, 5).map((k) => (k.textContent || "").trim().slice(0, 16)).filter(Boolean),
        });
      }
    }
  }

  return JSON.stringify({
    path: location.pathname,
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    hScroll: document.documentElement.scrollWidth > vw + 2,
    offenders: offenders.slice(0, 8),
    offenderCount: offenders.length,
    truncated: truncated.slice(0, 8),
    truncatedCount: truncated.length,
    candidates,
  });
})()`;

type PageReport = {
  route: string;
  landed: string;
  redirected: boolean;
  hScroll: boolean;
  offenderCount: number;
  offenders: Array<{ sel: string; width: number; right: number; left: number }>;
  truncatedCount: number;
  truncated: Array<{ sel: string; width: number; right: number; clipperWidth: number; clipper: string }>;
  wrapped: ReturnType<typeof findWrappedRows>;
};

async function auditWidth(width: number, routes: string[]): Promise<PageReport[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-layout-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${dir}`,
      `--window-size=${width},900`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    let pageWs: string | null = null;
    for (let i = 0; i < 60 && !pageWs; i++) {
      await sleep(300);
      try {
        const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as Array<{
          type: string;
          webSocketDebuggerUrl?: string;
        }>;
        pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {
        /* not up yet */
      }
    }
    if (!pageWs) throw new Error(`Chrome never exposed a debugger on ${CDP_PORT}`);

    const ws = new WebSocket(pageWs);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("CDP socket failed"));
    });

    let id = 0;
    const pending = new Map<number, (v: unknown) => void>();
    const loadWaiters: Array<() => void> = [];
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string };
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
      if (msg.method === "Page.loadEventFired") while (loadWaiters.length) loadWaiters.shift()!();
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((res) => {
        const myId = ++id;
        pending.set(myId, res as (v: unknown) => void);
        ws.send(JSON.stringify({ id: myId, method, params }));
      });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const navigate = async (url: string) => {
      const loaded = new Promise<void>((r) => {
        loadWaiters.push(r);
        setTimeout(r, 9000);
      });
      await send("Page.navigate", { url });
      await loaded;
      await sleep(1200);
    };
    const evaluate = async (expression: string) => {
      const r = (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
        result?: { result?: { value?: string } };
      };
      return r?.result?.result?.value ?? null;
    };

    // A logged-out run silently measures the landing page N times and reports a
    // clean pass, so sign in first and fail loudly if it didn't take.
    await navigate(`${BASE}/`);
    // Retry the click: on a cold `.next` the load event fires well before React
    // hydrates, so a single attempt lands on a button that has no handler yet.
    let landed = "/";
    for (let attempt = 0; attempt < 5; attempt++) {
      // Only click while genuinely still on the landing page: the button submits
      // a form, and firing it again mid-navigation double-posts the sign-in.
      const here = (await evaluate("location.pathname")) ?? "/";
      if (here !== "/") { landed = here; break; }
      await evaluate(
        `(() => { const b = [...document.querySelectorAll("button,a")].find(x => /enter demo/i.test(x.textContent || "")); if (b) { b.click(); return "clicked"; } return "absent"; })()`,
      );
      await sleep(3500);
      landed = (await evaluate("location.pathname")) ?? "/";
      if (landed !== "/") break;
    }
    if (landed === "/") {
      throw new Error(
        "Could not establish a session (still on /). Every closet route would redirect and the audit would be meaningless.",
      );
    }

    const reports: PageReport[] = [];
    for (const route of routes) {
      await navigate(BASE + route);
      const raw = await evaluate(COLLECT);
      if (!raw) {
        reports.push({
          route,
          landed: "?",
          redirected: true,
          hScroll: false,
          offenderCount: 0,
          offenders: [],
          truncatedCount: 0,
          truncated: [],
          wrapped: [],
        });
        continue;
      }
      const data = JSON.parse(raw) as {
        path: string;
        hScroll: boolean;
        offenders: PageReport["offenders"];
        offenderCount: number;
        truncated: PageReport["truncated"];
        truncatedCount: number;
        candidates: Candidate[];
      };
      reports.push({
        route,
        landed: data.path,
        redirected: data.path.replace(/\/$/, "") !== route.replace(/\/$/, ""),
        hScroll: data.hScroll,
        offenderCount: data.offenderCount,
        offenders: data.offenders,
        truncatedCount: data.truncatedCount,
        truncated: data.truncated,
        wrapped: findWrappedRows(data.candidates),
      });
    }

    ws.close();
    return reports;
  } finally {
    chrome.kill();
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* Chrome leaves handles behind; the temp dir is disposable */
    }
  }
}

async function main() {
  const only = argValue("--route");
  const widths = (argValue("--widths") ?? argValue("--width") ?? "1440,1280,1024")
    .split(",")
    .map((w) => Number(w.trim()))
    .filter((w) => Number.isFinite(w) && w > 0);

  let routes: string[];
  let skipped: string[] = [];
  if (only) {
    routes = [only];
  } else {
    const discovered = await discoverRoutes();
    const resolved = await resolveDynamic(discovered);
    routes = resolved.routes;
    skipped = resolved.skipped;
  }

  const all: Record<number, PageReport[]> = {};
  for (const w of widths) all[w] = await auditWidth(w, routes);

  const overflowing = Object.values(all)
    .flat()
    .filter((r) => r.offenderCount > 0 || r.hScroll || r.truncatedCount > 0);

  if (AS_JSON) {
    console.log(JSON.stringify({ widths, routes, skipped, results: all }, null, 2));
  } else {
    console.log(`Audited ${routes.length} route(s) at ${widths.join(", ")}px\n`);
    for (const w of widths) {
      const reports = all[w]!;
      const bad = reports.filter((r) => r.offenderCount > 0 || r.hScroll || r.truncatedCount > 0);
      console.log(`── ${w}px ──  overflow: ${bad.length}   redirects: ${reports.filter((r) => r.redirected).length}`);
      for (const r of bad) {
        console.log(`  OVERFLOW ${r.route}${r.hScroll ? " (page scrolls horizontally)" : ""}`);
        for (const o of r.offenders) console.log(`      off-screen: ${o.sel}  w=${o.width} right=${o.right}`);
        for (const t of r.truncated) {
          console.log(`      cut off by ${t.clipper} (${t.clipperWidth}px): ${t.sel}  w=${t.width}`);
        }
      }
      const wrapped = reports.filter((r) => r.wrapped.length > 0);
      if (wrapped.length > 0) {
        console.log(`  advisory — rows occupying more than one line:`);
        for (const r of wrapped) {
          for (const x of r.wrapped) {
            console.log(
              `      ${r.route.padEnd(30)} ${x.sel.slice(0, 42).padEnd(42)} ${x.kids} items → ${x.rows} rows (w=${x.width})${x.labels.length ? "  " + x.labels.join(",") : ""}`,
            );
          }
        }
      }
      console.log();
    }
    if (skipped.length > 0) {
      console.log(`Skipped (no safe stand-in for the dynamic segment): ${skipped.join(", ")}`);
    }
    const redirects = all[widths[0]!]!.filter((r) => r.redirected);
    if (redirects.length > 0) {
      console.log(`\nRedirected (measured at their destination):`);
      for (const r of redirects) console.log(`  ${r.route} → ${r.landed}`);
    }
  }

  if (overflowing.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
