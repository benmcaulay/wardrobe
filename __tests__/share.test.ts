import { describe, it, expect } from "vitest";
import {
  SHARE_KINDS,
  SHARE_KIND_LABELS,
  isShareKind,
  kindRequiresTarget,
  normalizeShareTarget,
  sharePath,
  shareUrl,
} from "../lib/share/kinds";
import { generateShareToken, isValidShareTokenFormat } from "../lib/share/token";
import {
  SHARE_DESTINATIONS,
  actionDestinations,
  getShareDestination,
  intentDestinations,
} from "../lib/share/destinations";

describe("share tokens", () => {
  it("generates URL-safe tokens of usable length", () => {
    for (let i = 0; i < 50; i += 1) {
      const t = generateShareToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(20);
      expect(isValidShareTokenFormat(t)).toBe(true);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateShareToken()));
    expect(seen.size).toBe(500);
  });

  it("rejects short, empty and malformed tokens before they hit the database", () => {
    expect(isValidShareTokenFormat("")).toBe(false);
    expect(isValidShareTokenFormat("short")).toBe(false);
    expect(isValidShareTokenFormat("a".repeat(19))).toBe(false);
    expect(isValidShareTokenFormat("a".repeat(65))).toBe(false);
    // Path traversal and separators must never look like a valid token.
    expect(isValidShareTokenFormat("../../etc/passwd")).toBe(false);
    expect(isValidShareTokenFormat("aaaaaaaaaaaaaaaaaaaa/b")).toBe(false);
    expect(isValidShareTokenFormat("aaaaaaaaaaaaaaaaaaaa.")).toBe(false);
    expect(isValidShareTokenFormat("aaaaaaaaaaaaaaaaaa aa")).toBe(false);
  });

  it("accepts a token of exactly the minimum length", () => {
    expect(isValidShareTokenFormat("a".repeat(20))).toBe(true);
  });
});

describe("share kinds", () => {
  it("recognises only the three kinds", () => {
    for (const k of SHARE_KINDS) expect(isShareKind(k)).toBe(true);
    expect(isShareKind("closet")).toBe(false);
    expect(isShareKind("")).toBe(false);
  });

  it("requires a target for items and outfits but not the wishlist", () => {
    expect(kindRequiresTarget("item")).toBe(true);
    expect(kindRequiresTarget("outfit")).toBe(true);
    expect(kindRequiresTarget("wishlist")).toBe(false);
  });

  it("gives every kind a label and a blurb", () => {
    for (const k of SHARE_KINDS) {
      expect(SHARE_KIND_LABELS[k].label.length).toBeGreaterThan(0);
      expect(SHARE_KIND_LABELS[k].blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeShareTarget", () => {
  it("accepts a target for an item", () => {
    expect(normalizeShareTarget("item", "abc")).toEqual({ ok: true, targetId: "abc" });
  });

  it("rejects an item share with no target", () => {
    expect(normalizeShareTarget("item", null).ok).toBe(false);
    expect(normalizeShareTarget("item", "   ").ok).toBe(false);
    expect(normalizeShareTarget("outfit", undefined).ok).toBe(false);
  });

  it("forces the wishlist target to null even if an id is passed", () => {
    expect(normalizeShareTarget("wishlist", "stray-id")).toEqual({ ok: true, targetId: null });
    expect(normalizeShareTarget("wishlist", null)).toEqual({ ok: true, targetId: null });
  });

  it("trims whitespace around an id", () => {
    expect(normalizeShareTarget("item", "  abc  ")).toEqual({ ok: true, targetId: "abc" });
  });
});

describe("share URLs", () => {
  it("builds a path under /s/", () => {
    expect(sharePath("tok123")).toBe("/s/tok123");
  });

  it("encodes the token", () => {
    expect(sharePath("a/b")).toBe("/s/a%2Fb");
  });

  it("joins an origin without doubling the slash", () => {
    expect(shareUrl("tok", "https://example.com")).toBe("https://example.com/s/tok");
    expect(shareUrl("tok", "https://example.com/")).toBe("https://example.com/s/tok");
  });
});

describe("share destinations", () => {
  it("separates navigating intents from client-side actions", () => {
    expect(intentDestinations().every((d) => !!d.href)).toBe(true);
    expect(actionDestinations().every((d) => !d.href)).toBe(true);
    expect(intentDestinations().length + actionDestinations().length).toBe(
      SHARE_DESTINATIONS.length,
    );
  });

  it("omits platforms that cannot accept a prefilled post from the web", () => {
    const ids = SHARE_DESTINATIONS.map((d) => d.id) as string[];
    for (const absent of ["instagram", "tiktok", "snapchat"]) {
      expect(ids).not.toContain(absent);
    }
  });

  it("URL-encodes the shared link into every intent", () => {
    const url = "https://example.com/s/tok?a=1&b=2";
    const title = "Ben's wishlist & more";
    for (const d of intentDestinations()) {
      const href = d.href!({ url, title });
      // The raw URL must not appear unescaped — that would truncate at the &.
      expect(href, `${d.id} leaked a raw url`).not.toContain(url);
      expect(href).toContain(encodeURIComponent(url).slice(0, 30));
    }
  });

  it("points every intent at that platform's real share endpoint", () => {
    const hosts: Record<string, string> = {
      x: "twitter.com",
      facebook: "facebook.com",
      pinterest: "pinterest.com",
      whatsapp: "wa.me",
      reddit: "reddit.com",
    };
    for (const [id, host] of Object.entries(hosts)) {
      const d = getShareDestination(id);
      expect(d, `missing destination ${id}`).toBeTruthy();
      expect(d!.href!({ url: "https://e.com", title: "t" })).toContain(host);
    }
    expect(getShareDestination("email")!.href!({ url: "https://e.com", title: "t" })).toMatch(
      /^mailto:/,
    );
  });

  it("names an icon that exists in the suite", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/icons.tsx", "utf8");
    const available = new Set([...src.matchAll(/\{ name: "([^"]+)"/g)].map((m) => m[1]));
    for (const d of SHARE_DESTINATIONS) {
      expect(available, `no icon "${d.icon}" for ${d.id}`).toContain(d.icon);
    }
  });
});
