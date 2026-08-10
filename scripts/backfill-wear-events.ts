/**
 * Seed the WearEvent log from the pre-existing timesWorn / lastWornAt counters.
 * Run with: pnpm db:backfill-wears  (needs DATABASE_URL + a migrated DB)
 *
 * ── What this can and cannot recover ────────────────────────────────────────
 *
 * The old schema stored a *count* and a *last-worn date*. It never stored the
 * dates in between, and no amount of processing brings them back. So this
 * script writes `timesWorn` events per item, all dated `lastWornAt`, flagged
 * `source: "backfill"`.
 *
 * That is deliberately lossy in an honest direction:
 *
 *   preserved — total wears, and the date of the most recent one
 *   discarded — every interval between wears
 *
 * The tempting alternative is to spread the N wears backwards over plausible
 * intervals so the history "looks right". Don't. The recurrence and dormancy
 * models in docs/OUTFIT_INTELLIGENCE.md §6 exist precisely to learn per-item
 * wear intervals, and handing them synthetic intervals would teach them a
 * pattern the user never had — with no way to tell later which intervals were
 * real. Stacked-on-one-date is obviously-missing data; invented spacing is
 * indistinguishable from evidence.
 *
 * Consumers filter these rows out of timing analysis via hasUsableTiming()
 * in lib/wear/signals.ts. They still count toward totals.
 *
 * Idempotent: items that already have backfill events are skipped, so a partial
 * run can simply be re-run.
 */
import { PrismaClient } from "@prisma/client";
import { rollUpWearEvents, wornOnFromLocalDate } from "../lib/wear/rollup";

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

async function main() {
  const candidates = await prisma.wardrobeItem.findMany({
    where: { timesWorn: { gt: 0 } },
    select: { id: true, userId: true, timesWorn: true, lastWornAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const alreadyDone = new Set(
    (
      await prisma.wearEvent.findMany({
        where: { source: "backfill" },
        select: { items: { select: { itemId: true } } },
      })
    ).flatMap((event) => event.items.map((item) => item.itemId)),
  );

  const todo = candidates.filter((item) => !alreadyDone.has(item.id));

  console.log(
    `${candidates.length} items with wears; ${alreadyDone.size} already backfilled; ${todo.length} to do.`,
  );
  if (DRY_RUN) {
    const events = todo.reduce((sum, item) => sum + item.timesWorn, 0);
    console.log(`[dry run] would create ${events} events across ${todo.length} items.`);
    return;
  }

  let items = 0;
  let events = 0;

  for (let offset = 0; offset < todo.length; offset += BATCH_SIZE) {
    const batch = todo.slice(offset, offset + BATCH_SIZE);

    await prisma.$transaction(async (tx) => {
      for (const item of batch) {
        // No lastWornAt means the counter was incremented before that column
        // existed, or the row was restored from an old backup. The item's own
        // creation date is the earliest defensible anchor — it is certainly not
        // worn before it was added.
        const anchor = wornOnFromLocalDate(item.lastWornAt ?? item.createdAt);

        for (let i = 0; i < item.timesWorn; i += 1) {
          await tx.wearEvent.create({
            data: {
              userId: item.userId,
              wornOn: anchor,
              source: "backfill",
              confidence: 1,
              items: { create: { itemId: item.id } },
            },
          });
          events += 1;
        }

        // Re-derive rather than trusting the old counter: this is the first
        // point where the mirror and the log must agree, and if they disagree
        // the log wins from here on.
        const rollup = rollUpWearEvents(
          Array.from({ length: item.timesWorn }, () => ({
            wornOn: anchor,
            confidence: 1,
            confirmedAt: null,
          })),
        );
        await tx.wardrobeItem.update({
          where: { id: item.id },
          data: {
            timesWorn: rollup.timesWorn,
            effectiveWears: rollup.effectiveWears,
            lastWornAt: rollup.lastWornAt,
          },
        });
        items += 1;
      }
    });

    console.log(`  ${Math.min(offset + BATCH_SIZE, todo.length)}/${todo.length} items`);
  }

  console.log(`Done: ${events} events across ${items} items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
