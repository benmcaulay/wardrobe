/**
 * Storage seam for user image files. Two drivers behind one key-based API:
 *
 *  - "local" (default): files under <cwd>/uploads/, served by the image routes.
 *  - "s3":  any S3-compatible object store. Built for Cloudflare R2 (no egress
 *           fees, generous free tier) but works against AWS S3 or a local MinIO
 *           for testing — set S3_FORCE_PATH_STYLE=true for MinIO.
 *
 * Keys are the DB-relative paths already stored on rows (e.g. "userId/uuid.jpg").
 * Nothing above this module needs to know which driver is active; pick one with
 * STORAGE_DRIVER ("local" | "s3"), or it auto-selects "s3" when R2_BUCKET is set.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

type Driver = "local" | "s3";

function selectedDriver(): Driver {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "s3" || explicit === "local") return explicit;
  return process.env.R2_BUCKET?.trim() ? "s3" : "local";
}

/**
 * Normalize a DB-relative key, rejecting anything that would escape the root
 * (leading "/", "..", etc.). Returns the clean posix key or null.
 */
export function safeKey(key: string): string | null {
  if (!key) return null;
  const normalized = path.posix.normalize(key).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes("\0")) return null;
  return normalized;
}

/**
 * Resolve a key to an absolute path under UPLOADS_ROOT, or null if it escapes.
 * Kept for the local driver and callers that still need a filesystem path.
 */
export function resolveUploadPath(key: string): string | null {
  const safe = safeKey(key);
  if (!safe) return null;
  const absolute = path.resolve(UPLOADS_ROOT, safe);
  const root = path.resolve(UPLOADS_ROOT);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

export function contentTypeFor(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// --- S3 / R2 driver (lazy: the SDK and client only load when used) ----------

let s3Singleton: import("@aws-sdk/client-s3").S3Client | null = null;

async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  if (s3Singleton) return s3Singleton;
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (process.env.R2_ACCOUNT_ID?.trim()
      ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`
      : undefined);
  s3Singleton = new S3Client({
    region: process.env.R2_REGION?.trim() || "auto",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3Singleton;
}

function bucket(): string {
  const b = process.env.R2_BUCKET?.trim();
  if (!b) throw new Error("STORAGE_DRIVER is s3 but R2_BUCKET is not set");
  return b;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // AWS SDK v3 returns a web/Node stream; transformToByteArray covers both.
  const b = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (b?.transformToByteArray) return Buffer.from(await b.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// --- Public API -------------------------------------------------------------

/** Write an object. `contentType` defaults to the type implied by the key's extension. */
export async function putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
  const safe = safeKey(key);
  if (!safe) throw new Error(`Invalid storage key: ${key}`);
  const ct = contentType ?? contentTypeFor(safe);

  if (selectedDriver() === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    await client.send(
      new PutObjectCommand({ Bucket: bucket(), Key: safe, Body: body, ContentType: ct }),
    );
    return;
  }
  const abs = resolveUploadPath(safe)!;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

/** Read an object, or null when it doesn't exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const safe = safeKey(key);
  if (!safe) return null;

  if (selectedDriver() === "s3") {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: safe }));
      return await streamToBuffer(res.Body);
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }
  const abs = resolveUploadPath(safe);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

/** True if the object exists. */
export async function objectExists(key: string): Promise<boolean> {
  const safe = safeKey(key);
  if (!safe) return false;

  if (selectedDriver() === "s3") {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: safe }));
      return true;
    } catch {
      return false;
    }
  }
  const abs = resolveUploadPath(safe);
  if (!abs) return false;
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Delete a single object (best-effort; missing is not an error). */
export async function deleteObject(key: string): Promise<void> {
  const safe = safeKey(key);
  if (!safe) return;

  if (selectedDriver() === "s3") {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: safe }));
    return;
  }
  const abs = resolveUploadPath(safe);
  if (abs) await fs.rm(abs, { force: true });
}

/** Delete everything under a key prefix (e.g. a user's whole folder). */
export async function deletePrefix(prefix: string): Promise<void> {
  const safe = safeKey(prefix);
  if (!safe) return;

  if (selectedDriver() === "s3") {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    let token: string | undefined;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket(),
          Prefix: safe.endsWith("/") ? safe : `${safe}/`,
          ContinuationToken: token,
        }),
      );
      const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
      if (objects.length > 0) {
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects } }),
        );
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return;
  }
  const abs = resolveUploadPath(safe);
  if (abs) await fs.rm(abs, { recursive: true, force: true });
}

/**
 * A short-lived signed URL the client can fetch directly, offloading bytes from
 * the app server. Returns null for the local driver (callers then stream via
 * the image route). TTL defaults to 5 minutes.
 */
export async function getSignedReadUrl(key: string, ttlSeconds = 300): Promise<string | null> {
  if (selectedDriver() !== "s3") return null;
  const safe = safeKey(key);
  if (!safe) return null;

  // A CDN/public bucket base URL skips signing entirely.
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (publicBase) return `${publicBase.replace(/\/+$/, "")}/${safe}`;

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = await s3();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket(), Key: safe }), {
    expiresIn: ttlSeconds,
  });
}

/** Which driver is active (for logging / diagnostics). */
export function storageDriver(): Driver {
  return selectedDriver();
}
