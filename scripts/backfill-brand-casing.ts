/**
 * Settle brands that already exist in two spellings, once.
 *
 * Saving now rewrites a typed brand to whatever spelling the user's first
 * piece of that brand established, but rows written before that change keep
 * their own casing — so the closet still offers "adidas" and "Adidas" as two
 * separate filters. This rewrites the later spellings to the earliest one.
 *
 * Per user, because two people may legitimately disagree about a brand's
 * capitalisation and neither should overwrite the other.
 *
 * Idempotent: rows that already match the winning spelling are untouched, and
 * a brand with only one spelling is never rewritten. Safe to run repeatedly.
 *
 * Run with: pnpm tsx scripts/backfill-brand-casing.ts [--apply]
 * Defaults to a dry run, because it writes to the closet the user looks at.
 */
import { prisma } from "../lib/db";
import { brandKey, normalizeBrandInput } from "../lib/brand-name";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.wardrobeItem.findMany({
    where: { brand: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, brand: true },
  });

  // userId + brand key -> the spelling of the oldest row carrying it.
  const winners = new Map<string, string>();
  for (const row of rows) {
    const spelling = normalizeBrandInput(row.brand);
    if (!spelling) continue;
    const key = `${row.userId} ${brandKey(spelling)}`;
    if (!winners.has(key)) winners.set(key, spelling);
  }

  const fixes = rows.flatMap((row) => {
    const spelling = normalizeBrandInput(row.brand);
    if (!spelling) return [];
    const winner = winners.get(`${row.userId} ${brandKey(spelling)}`);
    if (!winner || winner === row.brand) return [];
    return [{ id: row.id, from: row.brand!, to: winner }];
  });

  if (fixes.length === 0) {
    console.log(`${rows.length} branded item(s); every brand already has one spelling.`);
    return;
  }

  const byChange = new Map<string, number>();
  for (const fix of fixes) {
    const label = `${fix.from} => ${fix.to}`;
    byChange.set(label, (byChange.get(label) ?? 0) + 1);
  }
  console.log(`${fixes.length} of ${rows.length} branded item(s) to rewrite:`);
  for (const [label, count] of [...byChange].sort()) {
    console.log(`  ${label}  (${count} item${count === 1 ? "" : "s"})`);
  }

  if (apply) {
    for (const fix of fixes) {
      await prisma.wardrobeItem.update({ where: { id: fix.id }, data: { brand: fix.to } });
    }
  }

  console.log(apply ? "Done." : "Dry run — pass --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
