/**
 * Server-side write paths for the wear + preference logs.
 *
 * Every write goes through here so two invariants hold everywhere:
 *
 *   1. WardrobeItem.timesWorn / effectiveWears / lastWornAt are never mutated
 *      directly — they are recomputed from events (lib/wear/rollup.ts). Direct
 *      increments were how the counters drifted out of sync with reality in the
 *      first place, and a counter you cannot reconstruct is a counter you
 *      cannot trust.
 *   2. Confidence is resolved from the source rather than trusted from the
 *      caller, so no code path can quietly record a camera-roll guess as fact.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import type { ClimateBand } from "@/lib/services/weather";
import type { Occasion } from "@/lib/wear/occasions";
import { rollUpWearEvents } from "@/lib/wear/rollup";
import {
  CONFIRMED_CONFIDENCE,
  PHOTO_CONFIDENCE_FLOOR,
  resolveWearConfidence,
  type PreferenceKind,
  type WearSource,
} from "@/lib/wear/signals";

export type WearContext = {
  tempHighC?: number | null;
  climateBand?: ClimateBand | null;
  precipMm?: number | null;
  occasion?: Occasion | null;
  wearerId?: string | null;
  placeLabel?: string | null;
};

export type RecordWearInput = {
  userId: string;
  itemIds: string[];
  /** UTC-midnight calendar date — build it with the helpers in lib/wear/rollup.ts. */
  wornOn: Date;
  source: WearSource;
  /** Raw match strength for inferred sources; clamped to the source's band. */
  confidence?: number | null;
  outfitId?: string | null;
  context?: WearContext;
};

type Tx = Prisma.TransactionClient;

/**
 * Recompute the denormalized counters for the given items from their events.
 *
 * One query for all affected items rather than one per item: logging a full
 * outfit touches five or six rows at once, and the per-item version turned that
 * into a round-trip storm on every wear.
 */
export async function refreshWearRollup(tx: Tx, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;

  const rows = await tx.wearEventItem.findMany({
    where: { itemId: { in: itemIds } },
    select: {
      itemId: true,
      wearEvent: { select: { wornOn: true, confidence: true, confirmedAt: true } },
    },
  });

  const byItem = new Map<string, { wornOn: Date; confidence: number; confirmedAt: Date | null }[]>();
  for (const id of itemIds) byItem.set(id, []);
  for (const row of rows) {
    byItem.get(row.itemId)?.push(row.wearEvent);
  }

  for (const [itemId, events] of byItem) {
    const rollup = rollUpWearEvents(events);
    await tx.wardrobeItem.update({
      where: { id: itemId },
      data: {
        timesWorn: rollup.timesWorn,
        effectiveWears: rollup.effectiveWears,
        lastWornAt: rollup.lastWornAt,
      },
    });
  }
}

/**
 * Log one wearing occasion. Returns the event id, or null when nothing was
 * recorded (no items, or an inference too weak to be worth storing).
 */
export async function recordWear(input: RecordWearInput): Promise<string | null> {
  const itemIds = [...new Set(input.itemIds)].filter(Boolean);
  if (itemIds.length === 0) return null;

  const confidence = resolveWearConfidence(input.source, input.confidence);
  // A match this weak is noise. Storing it would dilute effectiveWears and give
  // the dormancy model a phantom recent wear to suppress a true finding with.
  if (input.source === "photo" && confidence <= PHOTO_CONFIDENCE_FLOOR) return null;

  const context = input.context ?? {};

  return prisma.$transaction(async (tx) => {
    // Scope the ids to the caller's own closet inside the transaction rather
    // than trusting the argument — this runs from server actions and a stray id
    // would otherwise attach one user's wear history to another user's item.
    const owned = await tx.wardrobeItem.findMany({
      where: { id: { in: itemIds }, userId: input.userId },
      select: { id: true },
    });
    if (owned.length === 0) return null;

    const event = await tx.wearEvent.create({
      data: {
        userId: input.userId,
        wornOn: input.wornOn,
        source: input.source,
        confidence,
        outfitId: input.outfitId ?? null,
        tempHighC: context.tempHighC ?? null,
        climateBand: context.climateBand ?? null,
        precipMm: context.precipMm ?? null,
        occasion: context.occasion ?? null,
        wearerId: context.wearerId ?? null,
        placeLabel: context.placeLabel ?? null,
        items: { create: owned.map((item) => ({ itemId: item.id })) },
      },
      select: { id: true },
    });

    await refreshWearRollup(
      tx,
      owned.map((item) => item.id),
    );
    return event.id;
  });
}

/**
 * Promote an inferred wear to fact after the user confirms it, optionally
 * attaching the occasion label the prompt collected. This is the highest-value
 * write in the system: it is the only source of occasion data and it converts
 * cheap noisy inference into clean supervision.
 */
export async function confirmWear(
  userId: string,
  wearEventId: string,
  occasion?: Occasion | null,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.wearEvent.findFirst({
      where: { id: wearEventId, userId },
      select: { id: true, items: { select: { itemId: true } } },
    });
    if (!event) return false;

    await tx.wearEvent.update({
      where: { id: event.id },
      data: {
        confidence: CONFIRMED_CONFIDENCE,
        confirmedAt: new Date(),
        ...(occasion ? { occasion } : {}),
      },
    });
    await refreshWearRollup(
      tx,
      event.items.map((item) => item.itemId),
    );
    return true;
  });
}

/** Drop a wear the user says never happened, and re-derive the counters. */
export async function deleteWear(userId: string, wearEventId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.wearEvent.findFirst({
      where: { id: wearEventId, userId },
      select: { id: true, items: { select: { itemId: true } } },
    });
    if (!event) return false;

    const itemIds = event.items.map((item) => item.itemId);
    await tx.wearEvent.delete({ where: { id: event.id } });
    await refreshWearRollup(tx, itemIds);
    return true;
  });
}

export type RecordPreferenceInput = {
  userId: string;
  kind: PreferenceKind;
  itemIds: string[];
  /** What was passed over, for contrastive kinds. Enables `chosen ≻ rejected`. */
  rejectedIds?: string[];
  context?: Record<string, unknown>;
  /** Identifies the ranker that produced the thing being reacted to. */
  policyId?: string | null;
  /**
   * P(this suggestion was shown | policy). Logged from day one so a future
   * ranker can be scored off historical data (IPS/SNIPS) instead of needing a
   * live A/B test. Impossible to reconstruct after the fact.
   */
  propensity?: number | null;
};

export async function recordPreference(input: RecordPreferenceInput): Promise<string | null> {
  const itemIds = [...new Set(input.itemIds)].filter(Boolean);
  if (itemIds.length === 0) return null;
  const rejectedIds = [...new Set(input.rejectedIds ?? [])].filter(Boolean);

  const event = await prisma.preferenceEvent.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      itemIds: encode(itemIds),
      rejectedIds: encode(rejectedIds),
      contextJson: input.context ? encode(input.context) : null,
      policyId: input.policyId ?? null,
      propensity: input.propensity ?? null,
    },
    select: { id: true },
  });
  return event.id;
}
