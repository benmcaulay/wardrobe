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

describe("driver selection", () => {
  const clearStorageEnv = () => {
    for (const suffix of ["BUCKET", "ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "ACCOUNT_ID", "REGION"]) {
      delete process.env[`S3_${suffix}`];
      delete process.env[`R2_${suffix}`];
    }
    delete process.env.STORAGE_DRIVER;
  };

  it("defaults to local with nothing configured", () => {
    clearStorageEnv();
    expect(storageDriver()).toBe("local");
  });

  /**
   * The trap this caused in practice: scaffolding S3_BUCKET ahead of the
   * credentials silently switched the whole app to the s3 driver, and every
   * upload failed with the SDK's "InvalidAccessKeyId" — which names nothing you
   * can act on and points five frames deep into an upload.
   */
  it("selects s3 from the bucket alone, even with STORAGE_DRIVER blank", () => {
    clearStorageEnv();
    process.env.STORAGE_DRIVER = "";
    process.env.S3_BUCKET = "wardrobe-images";
    expect(storageDriver()).toBe("s3");
  });

  it("honours the legacy R2_BUCKET spelling", () => {
    clearStorageEnv();
    process.env.R2_BUCKET = "wardrobe-images";
    expect(storageDriver()).toBe("s3");
  });

  it("lets an explicit local override a set bucket", () => {
    clearStorageEnv();
    process.env.S3_BUCKET = "wardrobe-images";
    process.env.STORAGE_DRIVER = "local";
    expect(storageDriver()).toBe("local");
  });

  it("names the missing credentials instead of failing inside the AWS SDK", async () => {
    clearStorageEnv();
    process.env.S3_BUCKET = "wardrobe-images";
    process.env.S3_ENDPOINT = "https://example.supabase.co/storage/v1/s3";
    const { putObject } = await import("../lib/storage");
    await expect(putObject("u/x.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow(
      /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/,
    );
  });
});
