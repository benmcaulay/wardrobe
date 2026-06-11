/**
 * Integration check for the generation job queue against a real Postgres.
 * Run with: pnpm test:jobs  (needs DATABASE_URL + a migrated DB)
 *
 * Exercises enqueue, concurrency-safe claim (FOR UPDATE SKIP LOCKED), the
 * worker drain executing a real (stub-mode) try-on end to end, and the
 * retry/permanent-failure paths — none of which the pure unit tests can cover.
 */
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { enqueueJob, claimNextJob, getJobForUser } from "../lib/jobs/queue";
import { drainOnce } from "../lib/jobs/worker";
import { runJob } from "../lib/jobs/runner";
import { UPLOADS_ROOT } from "../lib/storage";

const prisma = new PrismaClient();
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
};

async function makeUserWithPersonAndItem() {
  const user = await prisma.user.create({
    data: { email: `jobs-${Date.now()}-${Math.random()}@test.local`, credits: 100 },
  });
  const dir = path.join(UPLOADS_ROOT, user.id);
  await fs.mkdir(dir, { recursive: true });
  const personKey = path.posix.join(user.id, "person.jpg");
  const garmentKey = path.posix.join(user.id, "garment.jpg");
  await sharp({ create: { width: 600, height: 800, channels: 3, background: "#c9b9a4" } })
    .jpeg()
    .toFile(path.join(UPLOADS_ROOT, personKey));
  await sharp({ create: { width: 400, height: 400, channels: 3, background: "#7a8c6f" } })
    .jpeg()
    .toFile(path.join(UPLOADS_ROOT, garmentKey));
  const person = await prisma.personPhoto.create({
    data: { userId: user.id, imagePath: personKey },
  });
  const item = await prisma.wardrobeItem.create({
    data: {
      userId: user.id,
      name: "Tee",
      category: "top",
      colors: "[]",
      styleTags: "[]",
      season: "[]",
      originalImagePath: garmentKey,
    },
  });
  return { user, person, item };
}

async function main() {
  const { user, person, item } = await makeUserWithPersonAndItem();

  // 1. enqueue + happy-path drain (stub generation)
  const jobId = await enqueueJob(user.id, "virtual_tryon", {
    personPhotoId: person.id,
    itemIds: [item.id],
    outfitId: null,
  });
  const queued = await getJobForUser(jobId, user.id);
  assert(queued?.status === "queued", "job starts queued");

  const ran = await drainOnce();
  assert(ran >= 1, "drainOnce ran at least one job");

  const done = await getJobForUser<{ tryOnId: string; resultImagePath: string }>(jobId, user.id);
  assert(done?.status === "succeeded", "job reaches succeeded");
  assert(!!done?.result?.tryOnId, "result carries the VirtualTryOn id");
  const tryOn = await prisma.virtualTryOn.findUnique({ where: { id: done!.result!.tryOnId } });
  assert(tryOn !== null, "VirtualTryOn row was created by the runner");
  const outAbs = path.join(UPLOADS_ROOT, done!.result!.resultImagePath);
  assert(
    await fs.access(outAbs).then(() => true).catch(() => false),
    "result image was written to storage",
  );

  // 2. ownership isolation on status polling
  const other = await prisma.user.create({
    data: { email: `other-${Date.now()}@test.local`, credits: 0 },
  });
  assert((await getJobForUser(jobId, other.id)) === null, "another user can't read the job");

  // 3. claim is exclusive (a claimed job isn't re-claimable)
  const j2 = await enqueueJob(user.id, "virtual_tryon", {
    personPhotoId: person.id,
    itemIds: [item.id],
    outfitId: null,
  });
  const claimedA = await claimNextJob();
  assert(claimedA?.id === j2, "claimNextJob returns the queued job");
  assert(claimedA?.status === "running", "claimed job is marked running");
  // Nothing else queued now → second claim is null (proves it wasn't double-claimed).
  const claimedB = await claimNextJob();
  assert(claimedB === null, "a running job is not re-claimed");

  // 4. permanent failure (bad person id) terminally fails, no retry
  const badJobId = await enqueueJob(user.id, "virtual_tryon", {
    personPhotoId: "does-not-exist",
    itemIds: [item.id],
    outfitId: null,
  });
  const badJob = await claimNextJob();
  assert(badJob?.id === badJobId, "claimed the bad job");
  await runJob(badJob!);
  const badAfter = await getJobForUser(badJobId, user.id);
  assert(badAfter?.status === "failed", "permanent error -> failed (no retry)");
  assert(/not found/i.test(badAfter?.error ?? ""), "failure carries the error message");

  // cleanup
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await fs.rm(path.join(UPLOADS_ROOT, user.id), { recursive: true, force: true });

  console.log("\nAll job-queue checks passed.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
