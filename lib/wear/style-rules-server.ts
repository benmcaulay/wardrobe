/**
 * Loading a user's active styling rules for the scorer (§9).
 *
 * Not a server *action*: nothing on the client calls it, and an endpoint that
 * dumps someone's notes is surface with no purpose. The daily slate is built
 * server-side, so this is called directly from there.
 */

import { prisma } from "@/lib/db";
import { decode } from "@/lib/json";
import { isValidRule, type AttributedRule, type StyleRule } from "@/lib/outfit/style-rules";

/**
 * Every active rule for a user, with the note it came from attached.
 *
 * Re-validated on read against the ids the note was written about. A garment
 * deleted since — or a rule that was valid when parsed and isn't now — drops
 * out here rather than silently constraining the scorer forever.
 */
export async function loadStyleRules(userId: string): Promise<AttributedRule[]> {
  const [rows, closet] = await Promise.all([
    prisma.styleNote.findMany({
      where: { userId, active: true },
      select: { id: true, text: true, rules: true, subjectIds: true, scope: true },
    }),
    prisma.wardrobeItem.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const closetIds = new Set(closet.map((item) => item.id));

  const out: AttributedRule[] = [];
  for (const row of rows) {
    // Outfit-scoped notes are pinned to what was on screen; closet-scoped ones
    // float against the current wardrobe, so a deleted garment drops its rule.
    const known = row.scope === "closet" ? closetIds : new Set(decode<string[]>(row.subjectIds, []));
    for (const rule of decode<StyleRule[]>(row.rules, [])) {
      if (!isValidRule(rule, known)) continue;
      out.push({ rule, noteId: row.id, noteText: row.text });
    }
  }
  return out;
}
