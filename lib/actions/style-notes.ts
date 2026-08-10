"use server";

/**
 * Capturing and applying the user's styling notes (§9).
 *
 * The interaction this exists for: a proposal is on screen, something about it
 * is wrong in a way only the user knows, and they say so in one sentence —
 * "don't put that hat with that shirt". No form, no taxonomy, no asking them to
 * classify their own advice.
 *
 * Notes are captured *against the visible outfit*, which is what makes them
 * cheap to interpret: the parser is handed those garments and only has to
 * decide which of them the sentence is about. See lib/outfit/style-rules.ts for
 * why these become structured rules rather than embeddings.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode } from "@/lib/json";
import { MAX_NOTE_LENGTH, type NoteScope, type StyleRule } from "@/lib/outfit/style-rules";
import { parseStyleNote, type NoteSubject } from "@/lib/services/styleNoteParser";

export type SavedNote = {
  id: string;
  text: string;
  summary: string | null;
  ruleCount: number;
  source: string;
  createdAt: string;
};

export type AddNoteResponse =
  | { ok: true; note: SavedNote; understood: boolean }
  | { ok: false; error: string };

/**
 * Save a note written about a specific set of on-screen garments.
 *
 * A note that parses to nothing is still stored. The user took the trouble to
 * write it, the text is a real record of intent, and a better parser can
 * revisit it later — silently discarding it would be the one outcome that
 * teaches them not to bother.
 */
export async function addStyleNote(
  text: string,
  subjectItemIds: string[],
): Promise<AddNoteResponse> {
  const user = await requireUser();
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return { ok: false, error: "Nothing to save" };

  // An empty subject list means the general tip box: nothing was on screen, so
  // the note resolves against the whole wardrobe instead. Widening the scope is
  // the only honest option — "the green sweater" has to be findable somewhere —
  // and it costs the parser precision, which is why the contextual box stays
  // the better place to write one.
  const scope: NoteScope = subjectItemIds.length === 0 ? "closet" : "outfit";

  // Scope the subjects to the caller's own closet before they reach the
  // parser: they become the allow-list its output is validated against, so a
  // stray id here would let a rule reference someone else's garment.
  const owned = await prisma.wardrobeItem.findMany({
    where:
      scope === "closet"
        ? { userId: user.id, isWishlist: false }
        : { id: { in: subjectItemIds }, userId: user.id },
    select: { id: true, name: true, category: true },
  });
  if (owned.length === 0) return { ok: false, error: "Couldn't tell which pieces you meant." };

  const subjects: NoteSubject[] = owned;
  const parsed = await parseStyleNote(trimmed, subjects);

  const created = await prisma.styleNote.create({
    data: {
      userId: user.id,
      text: trimmed,
      scope,
      // Closet-scoped notes store no allow-list: they are re-validated against
      // the *current* closet on read, so a rule naming a garment that has since
      // been deleted simply stops applying instead of lingering forever.
      subjectIds: encode(scope === "closet" ? [] : owned.map((item) => item.id)),
      rules: encode(parsed.rules),
      summary: parsed.summary || null,
      source: parsed.source,
    },
    select: { id: true, text: true, summary: true, source: true, createdAt: true },
  });

  revalidatePath("/closet/outfits");
  return {
    ok: true,
    understood: parsed.rules.length > 0,
    note: {
      id: created.id,
      text: created.text,
      summary: created.summary,
      ruleCount: parsed.rules.length,
      source: created.source,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function listStyleNotes(): Promise<SavedNote[]> {
  const user = await requireUser();
  const rows = await prisma.styleNote.findMany({
    where: { userId: user.id, active: true },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, text: true, summary: true, rules: true, source: true, createdAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    summary: row.summary,
    ruleCount: decode<StyleRule[]>(row.rules, []).length,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Switch a note off without deleting what the user wrote. */
export async function deactivateStyleNote(
  noteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const result = await prisma.styleNote.updateMany({
    where: { id: noteId, userId: user.id },
    data: { active: false },
  });
  if (result.count === 0) return { ok: false, error: "That note no longer exists." };

  revalidatePath("/closet/outfits");
  return { ok: true };
}
