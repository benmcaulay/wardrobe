import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CLOSET_NAV,
  activeNavItem,
  isNavItemActive,
  type ClosetNavItem,
} from "../lib/closet-nav";

function item(href: string, exact = false): ClosetNavItem {
  return { href, label: href, hint: "", icon: "closet", exact };
}

describe("isNavItemActive", () => {
  it("matches the exact path", () => {
    expect(isNavItemActive(item("/closet/sell"), "/closet/sell")).toBe(true);
  });

  it("matches nested routes within a section", () => {
    expect(isNavItemActive(item("/closet/sell"), "/closet/sell/listings")).toBe(true);
    expect(isNavItemActive(item("/closet/smartpakker"), "/closet/smartpakker/abc123")).toBe(true);
  });

  it("only matches on a path boundary", () => {
    // /closet/sell must not light up for /closet/sell-something-else.
    expect(isNavItemActive(item("/closet/sell"), "/closet/selling")).toBe(false);
    expect(isNavItemActive(item("/closet/sell"), "/closet/sell-fast")).toBe(false);
  });

  it("keeps an exact entry from matching its whole subtree", () => {
    const closet = item("/closet", true);
    expect(isNavItemActive(closet, "/closet")).toBe(true);
    expect(isNavItemActive(closet, "/closet/sell")).toBe(false);
    expect(isNavItemActive(closet, "/closet/wishlist")).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isNavItemActive(item("/closet", true), "/closet/")).toBe(true);
    expect(isNavItemActive(item("/closet/sell"), "/closet/sell/")).toBe(true);
  });

  it("ignores query strings and hashes", () => {
    expect(isNavItemActive(item("/closet", true), "/closet?brand=Nike")).toBe(true);
    expect(isNavItemActive(item("/closet/sell"), "/closet/sell#top")).toBe(true);
  });

  it("does not match an unrelated section", () => {
    expect(isNavItemActive(item("/closet/sell"), "/closet/wishlist")).toBe(false);
    expect(isNavItemActive(item("/closet/wishlist"), "/settings")).toBe(false);
  });
});

describe("activeNavItem", () => {
  it("prefers the most specific match over the hub", () => {
    // Both /closet and /closet/wishlist would match without exact handling;
    // the wishlist entry has to win.
    expect(activeNavItem("/closet/wishlist")?.href).toBe("/closet/wishlist");
    expect(activeNavItem("/closet/sell/listings")?.href).toBe("/closet/sell");
  });

  it("returns the hub on the closet index", () => {
    expect(activeNavItem("/closet")?.href).toBe("/closet");
  });

  it("returns null when nothing matches", () => {
    expect(activeNavItem("/settings")).toBeNull();
    expect(activeNavItem("/closet/add")).toBeNull();
  });
});

describe("CLOSET_NAV", () => {
  it("has no duplicate destinations", () => {
    const hrefs = CLOSET_NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("marks the closet hub exact so it doesn't match everything", () => {
    expect(CLOSET_NAV.find((i) => i.href === "/closet")?.exact).toBe(true);
  });

  it("gives every entry a label and a hint", () => {
    for (const entry of CLOSET_NAV) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.hint.length).toBeGreaterThan(0);
      expect(entry.href.startsWith("/")).toBe(true);
    }
  });

  it("names an icon that actually exists in the suite", () => {
    // The drawer falls back to a bullet for an unknown name, which would
    // silently strip the icons rather than fail — so assert the wiring here.
    const src = fs.readFileSync(path.join(process.cwd(), "components/icons.tsx"), "utf8");
    const available = new Set([...src.matchAll(/\{ name: "([^"]+)"/g)].map((m) => m[1]));
    for (const entry of CLOSET_NAV) {
      expect(available, `no icon named "${entry.icon}" for ${entry.href}`).toContain(entry.icon);
    }
  });

  it("lands every destination on a route that exists", () => {
    // Guards against a typo'd href shipping as a dead link.
    const known = new Set([
      "/closet",
      "/closet/today",
      "/closet/scan",
      "/closet/wear-scan",
      "/closet/try-on",
      "/closet/outfits",
      "/closet/smartpakker",
      "/closet/lenses",
      "/closet/sell",
      "/closet/wishlist",
      "/closet/share",
    ]);
    for (const entry of CLOSET_NAV) expect(known.has(entry.href)).toBe(true);
  });
});
