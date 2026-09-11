import { describe, expect, it } from "vitest";
import { CONFIRM_PARAM, confirmUrlFor, safeCallbackUrl } from "../lib/auth-confirm-link";

const ORIGIN = "https://makingspace.cloud";
const CALLBACK = `${ORIGIN}/api/auth/callback/email?token=abc&email=a%40b.com`;

describe("confirmUrlFor", () => {
  it("points at the confirm page on the same origin, carrying the callback", () => {
    const got = new URL(confirmUrlFor(CALLBACK));
    expect(got.origin).toBe(ORIGIN);
    expect(got.pathname).toBe("/auth/confirm");
    expect(got.searchParams.get(CONFIRM_PARAM)).toBe(CALLBACK);
  });

  it("preserves the token and email through the round trip", () => {
    const wrapped = confirmUrlFor(CALLBACK);
    const back = new URL(new URL(wrapped).searchParams.get(CONFIRM_PARAM)!);
    expect(back.searchParams.get("token")).toBe("abc");
    expect(back.searchParams.get("email")).toBe("a@b.com");
  });
});

describe("safeCallbackUrl", () => {
  it("accepts our own sign-in callback", () => {
    expect(safeCallbackUrl(CALLBACK, ORIGIN)).toBe(CALLBACK);
  });

  it("refuses another origin", () => {
    // The page exists to look trustworthy, so forwarding a click anywhere
    // would be an open redirect wearing this site's own domain.
    expect(safeCallbackUrl("https://evil.example/api/auth/callback/email", ORIGIN)).toBeNull();
  });

  it("refuses a same-origin path that is not the sign-in callback", () => {
    expect(safeCallbackUrl(`${ORIGIN}/closet`, ORIGIN)).toBeNull();
    expect(safeCallbackUrl(`${ORIGIN}/api/auth/signout`, ORIGIN)).toBeNull();
  });

  it("refuses junk rather than throwing", () => {
    for (const raw of [undefined, "", "not a url", "javascript:alert(1)"]) {
      expect(safeCallbackUrl(raw as string, ORIGIN)).toBeNull();
    }
  });

  it("is not fooled by a lookalike host", () => {
    expect(safeCallbackUrl("https://makingspace.cloud.evil.com/api/auth/callback/email", ORIGIN)).toBeNull();
  });
});

describe("appOrigin", () => {
  it("follows NEXTAUTH_URL, which is what the links are built from", async () => {
    const { appOrigin } = await import("../lib/app-origin");
    const prev = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://makingspace.cloud";
    expect(appOrigin()).toBe("https://makingspace.cloud");
    // A trailing path must not widen or narrow the origin comparison.
    process.env.NEXTAUTH_URL = "https://makingspace.cloud/api/auth";
    expect(appOrigin()).toBe("https://makingspace.cloud");
    process.env.NEXTAUTH_URL = "nonsense";
    expect(appOrigin()).toBe("http://localhost:3000");
    process.env.NEXTAUTH_URL = prev;
  });
});
