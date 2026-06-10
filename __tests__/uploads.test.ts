import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  saveUpload,
  UploadError,
  resolveUploadPath,
  thumbnailPathFor,
  imageUrl,
  thumbnailUrl,
  UPLOADS_ROOT,
  MAX_UPLOAD_BYTES,
} from "../lib/uploads";

const TEST_USER = "__test_user__";

async function cleanup() {
  await fs.rm(path.join(UPLOADS_ROOT, TEST_USER), { recursive: true, force: true });
}

afterAll(cleanup);

async function makeJpeg(width = 2000, height = 2000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#7a8c6f" } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

function fileFrom(buf: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buf)], name, { type });
}

describe("thumbnailPathFor", () => {
  it("replaces the extension slot with -thumb", () => {
    expect(thumbnailPathFor("abc/def.jpg")).toBe("abc/def-thumb.jpg");
    expect(thumbnailPathFor("u/img.png")).toBe("u/img-thumb.png");
  });
});

describe("imageUrl / thumbnailUrl", () => {
  it("build URLs under /api/images", () => {
    expect(imageUrl("u/a.jpg")).toBe("/api/images/u/a.jpg");
    expect(thumbnailUrl("u/a.jpg")).toBe("/api/images/u/a-thumb.jpg");
  });

  it("encodes path segments", () => {
    expect(imageUrl("user id/has space.jpg")).toBe("/api/images/user%20id/has%20space.jpg");
  });
});

describe("resolveUploadPath", () => {
  it("resolves a normal path inside uploads/", () => {
    expect(resolveUploadPath("u/a.jpg")).toBe(path.resolve(UPLOADS_ROOT, "u/a.jpg"));
  });

  it("rejects parent traversal", () => {
    expect(resolveUploadPath("../etc/passwd")).toBeNull();
    expect(resolveUploadPath("u/../../etc/passwd")).toBeNull();
  });

  it("strips leading slashes and still stays inside root", () => {
    expect(resolveUploadPath("/u/a.jpg")).toBe(path.resolve(UPLOADS_ROOT, "u/a.jpg"));
  });
});

describe("saveUpload", () => {
  it("rejects empty files", async () => {
    const f = fileFrom(Buffer.alloc(0), "x.jpg", "image/jpeg");
    await expect(saveUpload(f, TEST_USER)).rejects.toBeInstanceOf(UploadError);
  });

  it("rejects oversize files", async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    const f = fileFrom(big, "x.jpg", "image/jpeg");
    await expect(saveUpload(f, TEST_USER)).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects bad mime types", async () => {
    const f = fileFrom(Buffer.from("hi"), "x.gif", "image/gif");
    await expect(saveUpload(f, TEST_USER)).rejects.toMatchObject({ code: "bad_type" });
  });

  it("rejects files whose bytes aren't a real image even with a valid mime", async () => {
    const f = fileFrom(Buffer.from("not actually a jpeg"), "x.jpg", "image/jpeg");
    await expect(saveUpload(f, TEST_USER)).rejects.toMatchObject({ code: "decode_failed" });
  });

  it("writes an original + 400px thumbnail, and returns posix paths", async () => {
    const buf = await makeJpeg(2000, 2000);
    const f = fileFrom(buf, "upload.jpg", "image/jpeg");
    const saved = await saveUpload(f, TEST_USER);

    expect(saved.originalImagePath.startsWith(`${TEST_USER}/`)).toBe(true);
    expect(saved.thumbnailImagePath).toBe(thumbnailPathFor(saved.originalImagePath));
    expect(saved.width).toBeLessThanOrEqual(1536);
    expect(saved.height).toBeLessThanOrEqual(1536);

    const origAbs = path.join(UPLOADS_ROOT, saved.originalImagePath);
    const thumbAbs = path.join(UPLOADS_ROOT, saved.thumbnailImagePath);
    await expect(fs.stat(origAbs)).resolves.toBeTruthy();
    const thumbMeta = await sharp(thumbAbs).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(400);
    expect(thumbMeta.height).toBeLessThanOrEqual(400);
  });
});
