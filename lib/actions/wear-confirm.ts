"use server";

/**
 * Confirming inferred wears (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * Two jobs in one flow, which is why it is worth building carefully:
 *
 *   1. It promotes a low-confidence guess to fact, which is what lets inference
 *      be aggressive without the interface ever stating something the user
 *      would dispute.
 *   2. It is the *only* source of occasion labels. Calendar integration is out
 *      of scope, so if this prompt doesn't collect the occasion, nothing does
 *      and every context-conditioned model downstream stays unconditioned.
 *
 * Two taps, in exchange for a clean labelled training example. Design the flow
 * as a first-class data source, not an afterthought.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, type Color } from "@/lib/json";
import { confirmWear, deleteWear } from "@/lib/wear/record";
import { parseOccasion } from "@/lib/wear/occasions";
import { CONFIDENT_WEAR_THRESHOLD, wornOnToISODate } from "@/lib/wear/rollup";
import { hasUsableTiming, isWearSource } from "@/lib/wear/signals";

export type PendingWear = {
  id: string;
  wornOnISO: string;
  source: string;
  confidence: number;
  items: { id: string; name: string; imagePath: string; colors: Color[] }[];
};

/**
 * Inferred wears still awaiting a yes/no.
 *
 * Backfilled rows are excluded: they carry no real date (see
 * scripts/backfill-wear-events.ts), so asking "did you wear this on the 3rd?"
 * about one would be asking the user to confirm something we invented.
 */
export async function listPendingWears(limit = 20): Promise<PendingWear[]> {
  const user = await requireUser();

  const events = await prisma.wearEvent.findMany({
    where: {
      userId: user.id,
      confirmedAt: null,
      confidence: { lt: CONFIDENT_WEAR_THRESHOLD },
    },
    orderBy: { wornOn: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      wornOn: true,
      source: true,
      confidence: true,
      items: {
        select: {
          item: {
            select: { id: true, name: true, originalImagePath: true, ghostImagePath: true, colors: true },
          },
        },
      },
    },
  });

  return events
    .filter((event) => isWearSource(event.source) && hasUsableTiming(event.source))
    .map((event) => ({
      id: event.id,
      wornOnISO: wornOnToISODate(event.wornOn),
      source: event.source,
      confidence: event.confidence,
      items: event.items.map(({ item }) => ({
        id: item.id,
        name: item.name,
        imagePath: item.ghostImagePath ?? item.originalImagePath,
        colors: decode<Color[]>(item.colors, []),
      })),
    }));
}

export type ConfirmResponse = { ok: true } | { ok: false; error: string };

/** "Yes, that was me" — plus the occasion, which nothing else supplies. */
export async function confirmPendingWear(
  wearEventId: string,
  occasion?: string | null,
): Promise<ConfirmResponse> {
  const user = await requireUser();
  const ok = await confirmWear(user.id, wearEventId, parseOccasion(occasion));
  if (!ok) return { ok: false, error: "That wear no longer exists." };

  revalidatePath("/closet/today");
  revalidatePath("/closet");
  return { ok: true };
}

/**
 * "No, that wasn't me." Deletes rather than marking rejected.
 *
 * A wrong inference has no downstream value — there is no model that wants to
 * know we once mis-matched a photo — and keeping it would leave a row that
 * still counts toward `effectiveWears` unless every future query remembered to
 * filter it out.
 */
export async function rejectPendingWear(wearEventId: string): Promise<ConfirmResponse> {
  const user = await requireUser();
  const ok = await deleteWear(user.id, wearEventId);
  if (!ok) return { ok: false, error: "That wear no longer exists." };

  revalidatePath("/closet/today");
  revalidatePath("/closet");
  return { ok: true };
}
