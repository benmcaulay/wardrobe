"use server";

/**
 * Parsing a session directive. Nothing is stored: directives live in the
 * page's state and die with it (see lib/outfit/directives.ts for why), so this
 * action only interprets text and hands the result straight back.
 */

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { parseColors, parseStylePrefs } from "@/lib/json";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";
import { describeDirective, type SessionDirective } from "@/lib/outfit/directives";
import { MAX_CATALOG_ITEMS, parseDirective } from "@/lib/services/directiveParser";

export type DirectiveResult =
  | {
      ok: true;
      /** One sentence can carry several intents; each becomes its own chip. */
      directives: Array<{ directive: SessionDirective; summary: string }>;
      source: "keywords" | "ai" | "none";
    }
  | { ok: false; error: string };

export async function interpretDirective(text: string, id: string): Promise<DirectiveResult> {
  const user = await requireUser();
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return { ok: false, error: "Type an instruction first" };

  const [dbUser, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    // The closet as text, so the model can name real garments instead of
    // guessing at a property. ~2,100 tokens for 111 items; see
    // MAX_CATALOG_ITEMS in the parser for why it is capped rather than paged.
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      select: { id: true, name: true, category: true, brand: true, material: true, colors: true },
      take: MAX_CATALOG_ITEMS,
    }),
  ]);
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const catalog = rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    brand: row.brand,
    material: row.material,
    colors: parseColors(row.colors).map((c) => c.name),
  }));

  const { directives, source } = await parseDirective(
    trimmed,
    {
      categories: getCategoriesListFromPrefs(prefs),
      colors: getColorsListFromPrefs(prefs).map((c) => c.name),
    },
    id,
    catalog,
  );

  // Never an error path any more: anything clothing-shaped that cannot be
  // mapped comes back as an inert note, so what someone typed is always kept
  // and always visible.
  return {
    ok: true,
    directives: directives.map((directive) => ({
      directive,
      summary: describeDirective(directive),
    })),
    source,
  };
}
