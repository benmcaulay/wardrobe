/**
 * Manual S3-driver verification against an in-process S3-compatible server
 * (s3rver). Run with: pnpm tsx scripts/verify-s3.ts
 *
 * Exercises the SAME lib/storage.ts code path the app uses, so it validates the
 * real AWS SDK calls (put/get/head/list/delete + presigned URL) rather than a
 * mock of our own. Stands in for Supabase Storage / R2 / MinIO when none can be
 * pulled in this environment — and since s3rver needs path-style addressing, it
 * covers the same mode Supabase and MinIO require.
 *
 * Uses the canonical `S3_*` names, then re-checks that the legacy `R2_*` names
 * still resolve, because an existing .env silently falling through to local disk
 * would be an unpleasant way to discover the rename.
 */
import S3rver from "s3rver";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 4569;
const BUCKET = "wardrobe-test";

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s3rver-"));
  await fs.mkdir(path.join(dir, BUCKET), { recursive: true }); // pre-create bucket

  const server = new S3rver({
    port: PORT,
    address: "127.0.0.1",
    silent: true,
    directory: dir,
  });
  await server.run();

  // Point lib/storage at the local s3rver BEFORE importing it (module reads env).
  // Clear any real credentials the developer's .env may hold, so this never
  // reaches out to an actual bucket.
  for (const stale of ["BUCKET", "ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "ACCOUNT_ID", "REGION", "PUBLIC_BASE_URL"]) {
    delete process.env[`S3_${stale}`];
    delete process.env[`R2_${stale}`];
  }
  // Which spelling to exercise. The canonical S3_* names by default; the run is
  // repeated in a child process with the legacy R2_* names, because the S3
  // client is a module singleton and credential resolution cannot be re-tested
  // in-process once it has been built.
  const legacyNames = process.argv.includes("--legacy-names");
  const P = legacyNames ? "R2_" : "S3_";
  process.env.STORAGE_DRIVER = "s3";
  process.env[`${P}BUCKET`] = BUCKET;
  process.env[`${P}ENDPOINT`] = `http://127.0.0.1:${PORT}`;
  process.env[`${P}ACCESS_KEY_ID`] = "S3RVER";
  process.env[`${P}SECRET_ACCESS_KEY`] = "S3RVER";
  process.env.S3_FORCE_PATH_STYLE = "true";

  const storage = await import("../lib/storage");
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`  ok: ${msg}`);
  };

  const key = "user123/photo.jpg";
  const body = Buffer.from("hello-wardrobe-bytes");

  assert(storage.storageDriver() === "s3", `driver selected is s3 (${P}* names)`);

  await storage.putObject(key, body, "image/jpeg");
  assert(await storage.objectExists(key), "objectExists true after put");

  const got = await storage.getObject(key);
  assert(got !== null && got.equals(body), "getObject round-trips bytes");

  assert((await storage.getObject("user123/missing.jpg")) === null, "getObject missing -> null");
  assert((await storage.objectExists("user123/missing.jpg")) === false, "objectExists missing -> false");

  const signed = await storage.getSignedReadUrl(key, 300);
  assert(typeof signed === "string" && signed!.includes(BUCKET), "getSignedReadUrl returns a URL");
  const res = await fetch(signed!);
  const fetched = Buffer.from(await res.arrayBuffer());
  assert(res.ok && fetched.equals(body), "signed URL serves the exact bytes");

  // prefix delete
  await storage.putObject("user123/a/b.jpg", body, "image/jpeg");
  await storage.deletePrefix("user123");
  assert((await storage.objectExists(key)) === false, "deletePrefix removed nested key 1");
  assert((await storage.objectExists("user123/a/b.jpg")) === false, "deletePrefix removed nested key 2");

  // traversal rejection still holds on the s3 driver
  assert((await storage.getObject("../escape")) === null, "traversal key rejected");

  console.log(
    legacyNames
      ? "\nAll S3-driver checks passed with the legacy R2_* names."
      : "\nAll S3-driver checks passed.",
  );

  await server.close();
  await fs.rm(dir, { recursive: true, force: true });

  // Same suite again against the legacy spelling, in a fresh process.
  if (!legacyNames) {
    const { execFileSync } = await import("node:child_process");
    console.log("\nRe-running with the legacy R2_* names...");
    execFileSync(process.execPath, [...process.execArgv, process.argv[1]!, "--legacy-names"], {
      stdio: "inherit",
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
