"use server";

/**
 * Server side of camera-roll wear inference (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * Two jobs, both deliberately small: hand the client the closet vectors it
 * needs to match against, and accept the low-confidence wears that come back.
 *
 * The photos themselves never appear here. Decoding, cropping, embedding and
 * matching all happen in the browser (lib/wear/embedding-worker.ts); what
 * crosses the wire is a list of item ids and scores. That is the whole reason
 * inference was put on-device — a camera roll is the most sensitive thing this
 * product could touch, and the strongest guarantee is that it is never sent.
 */

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decodeEmbedding, CURRENT_EMBEDDING_MODEL } from "@/lib/wear/embedding";
import { MATCH_FLOOR } from "@/lib/wear/photo-match";
import { recordWear } from "@/lib/wear/record";
import { wornOnFromISODate } from "@/lib/wear/rollup";
import { PHOTO_CONFIDENCE_CEILING, PHOTO_CONFIDENCE_FLOOR } from "@/lib/wear/signals";

export type ClosetVectorPayload = { itemId: string; vector: number[] };

/**
 * Every embedded item in the closet, as plain arrays.
 *
 * A few hundred × 512 floats is ~1 MB of JSON — fine for one call, and it lets
 * the whole scan run without another round trip per photo. Items without a
 * current-model embedding are simply absent; they can't be matched until the
 * sync in lib/wear/embedding-sync.ts has covered them.
 */
export async function getClosetVectors(): Promise<ClosetVectorPayload[]> {
  const user = await requireUser();

  const rows = await prisma.itemEmbedding.findMany({
    where: { model: CURRENT_EMBEDDING_MODEL, item: { userId: user.id, isWishlist: false } },
    select: { itemId: true, vector: true },
  });

  return rows.map((row) => ({
    itemId: row.itemId,
    vector: Array.from(decodeEmbedding(new Uint8Array(row.vector))),
  }));
}

export type ScanFinding = {
  itemIds: string[];
  /** Photo capture date, "YYYY-MM-DD", from EXIF where available. */
  wornOnISO: string;
  confidence: number;
};

export type ScanCommitResponse =
  | { ok: true; recorded: number; skipped: number }
  | { ok: false; error: string };

/**
 * Write the findings as low-confidence wears awaiting confirmation.
 *
 * Nothing here is presented to the user as fact: these land under
 * `CONFIDENT_WEAR_THRESHOLD`, so they contribute to `effectiveWears` but not to
 * the `timesWorn` count the interface renders, and they surface in the
 * confirmation queue on /closet/today. That separation is what allows matching
 * to be aggressive — a wrong guess costs a tap, not a false statement.
 */
export async function commitScanFindings(
  findings: ScanFinding[],
): Promise<ScanCommitResponse> {
  const user = await requireUser();
  if (findings.length === 0) return { ok: true, recorded: 0, skipped: 0 };
  if (findings.length > 500) return { ok: false, error: "Too many findings in one batch" };

  // Re-scanning the same photos must not double-count. `groupFindingsByDay`
  // dedupes within one scan, but a user who runs the scan twice — or picks an
  // overlapping set of photos next time — would otherwise get a second event
  // for the same garment on the same day, inflating `effectiveWears` and
  // handing the recurrence model wears that never happened.
  const dates = findings
    .map((finding) => wornOnFromISODate(finding.wornOnISO))
    .filter((date): date is Date => date != null);

  const existing = new Set<string>();
  if (dates.length > 0) {
    const rows = await prisma.wearEvent.findMany({
      where: { userId: user.id, source: "photo", wornOn: { in: dates } },
      select: { wornOn: true, items: { select: { itemId: true } } },
    });
    for (const row of rows) {
      const iso = row.wornOn.toISOString().slice(0, 10);
      for (const item of row.items) existing.add(`${item.itemId}|${iso}`);
    }
  }

  let recorded = 0;
  let skipped = 0;

  for (const finding of findings) {
    const wornOn = wornOnFromISODate(finding.wornOnISO);
    if (!wornOn || finding.itemIds.length === 0) {
      skipped += 1;
      continue;
    }

    const fresh = finding.itemIds.filter(
      (itemId) => !existing.has(`${itemId}|${finding.wornOnISO}`),
    );
    if (fresh.length === 0) {
      skipped += 1;
      continue;
    }

    // Re-clamp server-side. The client computed these, and a confidence outside
    // the photo band — however it got there — would let inference masquerade as
    // an explicit log in every downstream aggregate.
    const confidence = Math.min(
      PHOTO_CONFIDENCE_CEILING,
      Math.max(PHOTO_CONFIDENCE_FLOOR, finding.confidence),
    );

    const id = await recordWear({
      userId: user.id,
      itemIds: fresh,
      wornOn,
      source: "photo",
      confidence,
    });
    if (id) {
      recorded += 1;
      for (const itemId of fresh) existing.add(`${itemId}|${finding.wornOnISO}`);
    } else {
      skipped += 1;
    }
  }

  return { ok: true, recorded, skipped };
}

/** Exposed so the client can show why a scan found nothing. */
export async function getScanReadiness(): Promise<{
  embedded: number;
  total: number;
  matchFloor: number;
}> {
  const user = await requireUser();
  const [embedded, total] = await Promise.all([
    prisma.itemEmbedding.count({
      where: { model: CURRENT_EMBEDDING_MODEL, item: { userId: user.id, isWishlist: false } },
    }),
    prisma.wardrobeItem.count({ where: { userId: user.id, isWishlist: false } }),
  ]);
  return { embedded, total, matchFloor: MATCH_FLOOR };
}
