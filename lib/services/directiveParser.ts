/**
 * Turning a typed outfit instruction into a structured directive.
 *
 * Two passes. Keywords first, because "a red hat" and "keep it formal" are the
 * overwhelming majority and cost nothing; the model only sees what keywords
 * declined to guess at ("something sharper", "dinner with her parents").
 *
 * The model's job is narrow on purpose: map English onto the vocabulary that
 * already exists — the user's own category labels, their colour list, and the
 * 0..10 formality ladder in lib/outfit/formality.ts. It is never asked to
 * invent weights. A free-form weight bag would be unauditable, would drift
 * against the ladder the scorer already uses, and would cost a call per
 * outfit rather than one per instruction.
 */

import { clampFormality, parseDirectiveKeywords, type SessionDirective } from "@/lib/outfit/directives";
import { boolEnv } from "@/lib/env";
import { geminiText, geminiTextConfigured, parseJsonLoose } from "./gemini-text";
import { log } from "@/lib/log";

export type DirectiveParse = {
  directive: SessionDirective | null;
  source: "keywords" | "ai" | "none";
};

function aiEnabled(): boolean {
  return boolEnv("USE_REAL_DIRECTIVE_PARSER") && geminiTextConfigured();
}

const SYSTEM = `You turn one short clothing instruction into a structured directive for an outfit picker.

Choose exactly one form:
- "include": the person wants a specific kind of garment in the outfit.
    "category" MUST be copied verbatim from the user's category list, or omitted if none fits.
    "terms" are descriptive words to match — colours copied verbatim from the colour list, or a
    material/pattern word. Omit anything you are unsure of; a wrong term is worse than none.
- "formality": the person described an occasion or a vibe rather than a garment.
    "target" is 0-10, where 0 is loungewear, 3 everyday casual, 6 smart casual, 9 black tie.

If the instruction is not about clothing at all, return {"kind":"none"}.`;

export async function parseDirective(
  text: string,
  vocab: { categories: readonly string[]; colors: readonly string[] },
  id: string,
): Promise<DirectiveParse> {
  const trimmed = text.trim();
  if (!trimmed) return { directive: null, source: "none" };

  const keyword = parseDirectiveKeywords(trimmed, vocab, id);
  if (keyword) return { directive: keyword, source: "keywords" };
  if (!aiEnabled()) return { directive: null, source: "none" };

  try {
    const raw = await geminiText(
      `${SYSTEM}

Category list: ${vocab.categories.join(", ")}
Colour list: ${vocab.colors.join(", ")}

Reply with ONLY valid JSON, one of:
{"kind":"include","category":"...","terms":["..."]}
{"kind":"formality","target":0-10}
{"kind":"none"}

Instruction:
${trimmed}`,
    );
    const parsed = parseJsonLoose<{ kind?: unknown; category?: unknown; terms?: unknown; target?: unknown }>(raw);
    if (!parsed) return { directive: null, source: "none" };

    if (parsed.kind === "formality" && typeof parsed.target === "number") {
      return {
        directive: { kind: "formality", id, text: trimmed, target: clampFormality(parsed.target) },
        source: "ai",
      };
    }

    if (parsed.kind === "include") {
      // Only accept labels the closet actually has. A hallucinated category
      // would match nothing and read to the user as the instruction being
      // ignored, with no way to tell why.
      const category =
        typeof parsed.category === "string" &&
        vocab.categories.some((c) => c.toLowerCase() === parsed.category!.toString().toLowerCase())
          ? vocab.categories.find((c) => c.toLowerCase() === parsed.category!.toString().toLowerCase())
          : undefined;
      const terms = Array.isArray(parsed.terms)
        ? parsed.terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 4)
        : [];
      if (!category && terms.length === 0) return { directive: null, source: "none" };
      return { directive: { kind: "include", id, text: trimmed, category, terms }, source: "ai" };
    }

    return { directive: null, source: "none" };
  } catch (err) {
    // An unparsed instruction is shown back as "not applied", which is honest.
    // Failing the whole add would lose what the user typed.
    log.error("directive.parse.failed", err, { text: trimmed.slice(0, 80) });
    return { directive: null, source: "none" };
  }
}
