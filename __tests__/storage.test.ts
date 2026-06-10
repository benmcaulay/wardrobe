import { describe, it, expect, afterEach } from "vitest";
import { safeKey, contentTypeFor, resolveUploadPath, storageDriver, UPLOADS_ROOT } from "../lib/storage";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("safeKey", () => {
  it("accepts normal DB-relative keys", () => {
    expect(safeKey("user123/abc.jpg")).toBe("user123/abc.jpg");
    expect(safeKey("a/b/c.png")).toBe("a/b/c.png");
  });

  it("rejects traversal and absolute paths", () => {
    expect(safeKey("../escape")).toBeNull();
    expect(safeKey("../../etc/passwd")).toBeNull();
    expect(safeKey("")).toBeNull();
    expect(safeKey("a/\0/b")).toBeNull();
  });

  it("strips leading slashes rather than treating keys as absolute", () => {
    expect(safeKey("/user/x.jpg")).toBe("user/x.jpg");
  });
});

describe("resolveUploadPath", () => {
  it("resolves under the uploads root", () => {
    expect(resolveUploadPath("u/x.jpg")).toBe(`${UPLOADS_ROOT}/u/x.jpg`);
  });
  it("rejects traversal", () => {
    expect(resolveUploadPath("../x")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("maps by extension, defaulting to jpeg", () => {
    expect(contentTypeFor("a/b.png")).toBe("image/png");
    expect(contentTypeFor("a/b.webp")).toBe("image/webp");
    expect(contentTypeFor("a/b.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("a/b.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("a/b")).toBe("image/jpeg");
  });
});

describe("storageDriver selection", () => {
  it("defaults to local", () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.R2_BUCKET;
    expect(storageDriver()).toBe("local");
  });
  it("auto-selects s3 when R2_BUCKET is set", () => {
    delete process.env.STORAGE_DRIVER;
    process.env.R2_BUCKET = "bucket";
    expect(storageDriver()).toBe("s3");
  });
  it("honours an explicit STORAGE_DRIVER override", () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.R2_BUCKET = "bucket";
    expect(storageDriver()).toBe("local");
  });
});
