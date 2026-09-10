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
import { parseStylePrefs } from "@/lib/json";
import { MAX_NOTE_LENGTH } from "@/lib/outfit/style-rules";
import { describeDirective, type SessionDirective } from "@/lib/outfit/directives";
import { parseDirective } from "@/lib/services/directiveParser";

export type DirectiveResult =
  | { ok: true; directive: SessionDirective; summary: string; source: "keywords" | "ai" }
  | { ok: false; error: string };

export async function interpretDirective(text: string, id: string): Promise<DirectiveResult> {
  const user = await requireUser();
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return { ok: false, error: "Type an instruction first" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);

  const { directive, source } = await parseDirective(
    trimmed,
    {
      categories: getCategoriesListFromPrefs(prefs),
      colors: getColorsListFromPrefs(prefs).map((c) => c.name),
    },
    id,
  );

  if (!directive) {
    return {
      ok: false,
      error: "I couldn't turn that into something to match on. Try naming a colour or a category.",
    };
  }
  return { ok: true, directive, summary: describeDirective(directive), source: source === "ai" ? "ai" : "keywords" };
}
