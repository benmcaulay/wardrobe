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
  /** One sentence can carry several intents: "formal but no tie" is two. */
  directives: SessionDirective[];
  source: "keywords" | "ai" | "none";
};

/**
 * Above this many words, a vibe match is treated as possibly qualified and
 * handed to the model. Three covers "keep it formal" and "something casual"
 * without swallowing "dinner with her parents at the club".
 */
const VIBE_CONTEXT_WORDS = 3;

function aiEnabled(): boolean {
  return boolEnv("USE_REAL_DIRECTIVE_PARSER") && geminiTextConfigured();
}

const SYSTEM = `You turn one short clothing instruction into structured directives for an outfit picker.

Return an ARRAY, because one sentence can carry several intents: "formal but no tie" is a
formality directive and an exclude directive. Infer what the person means, including from
occasions, weather, moods and places — decide what someone saying this would actually want to
wear, then express it using ONLY the forms below.

- {"kind":"include","category":"...","terms":["..."]}
    They want this in the outfit.
    "category" MUST be copied verbatim from the user's category list, or omitted if none fits.
    "terms" are matched against colour, material, pattern and the garment's name. Copy colours
    verbatim from the colour list. Omit anything you are unsure of — a wrong term is worse
    than none, because it silently matches the wrong clothes.
- {"kind":"exclude","category":"...","terms":["..."]}
    They want less of this. Same fields as include.
- {"kind":"formality","target":0-10}
    0 loungewear, 3 everyday casual, 6 smart casual, 9 black tie.
    Use this for occasions: "job interview" is 8, "dinner with her parents" is 6.
- {"kind":"warmth","target":0-3}
    0 is a single light layer, 1.5 mild, 3 deep winter.
    Use this for weather and places: "it is freezing" is 3, "beach day" is 0.
- {"kind":"note"}
    Clothing-related but not expressible above. Use this rather than forcing a bad fit.

An instruction can produce several: "warm but not the puffer" is a warmth directive and an
exclude. Return [] only when the text is not about clothing at all.`;

export async function parseDirective(
  text: string,
  vocab: { categories: readonly string[]; colors: readonly string[] },
  id: string,
): Promise<DirectiveParse> {
  const trimmed = text.trim();
  if (!trimmed) return { directives: [], source: "none" };

  const keyword = parseDirectiveKeywords(trimmed, vocab, id);
  /*
   * Keywords win for concrete garment asks — "a red hat" needs no reasoning
   * and should not cost a call. Vibe words are different: they are the ones
   * that carry qualifying context, and the keyword table cannot see it.
   * Measured: "I have a job interview at a startup" keyword-matches
   * "interview" and lands on formality 8, where the model reads the qualifier
   * and says 6. So a *vibe* match in a sentence long enough to be qualified
   * goes to the model anyway, while a bare "formal" stays free.
   */
  const wordCount = trimmed.split(/\s+/).length;
  const isVibe = keyword?.kind === "formality" || keyword?.kind === "warmth";
  const keywordIsEnough = keyword && !(isVibe && wordCount > VIBE_CONTEXT_WORDS);
  if (keywordIsEnough) return { directives: [keyword], source: "keywords" };
  // Nothing recognisable and no model available: keep the words rather than
  // refusing them, so the instruction is still visible and still deletable.
  if (!aiEnabled()) {
    // No model: a rough vibe reading beats discarding the instruction.
    if (keyword) return { directives: [keyword], source: "keywords" };
    return { directives: [{ kind: "note", id, text: trimmed }], source: "none" };
  }

  try {
    const raw = await geminiText(
      `${SYSTEM}

Category list: ${vocab.categories.join(", ")}
Colour list: ${vocab.colors.join(", ")}

Reply with ONLY a valid JSON array, for example:
[{"kind":"warmth","target":2.6},{"kind":"exclude","category":"jacket","terms":["denim"]}]

Instruction:
${trimmed}`,
    );

    const parsed = parseJsonLoose<unknown>(raw);
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const directives: SessionDirective[] = [];

    rows.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      const r = row as { kind?: unknown; category?: unknown; terms?: unknown; target?: unknown };
      // Each intent from one sentence needs its own id, or removing the chip
      // for "no tie" would also remove the "formal" it arrived with.
      const rowId = index === 0 ? id : `${id}-${index}`;

      if (r.kind === "formality" && typeof r.target === "number") {
        directives.push({ kind: "formality", id: rowId, text: trimmed, target: clampFormality(r.target) });
        return;
      }
      if (r.kind === "warmth" && typeof r.target === "number") {
        directives.push({
          kind: "warmth",
          id: rowId,
          text: trimmed,
          target: Math.min(3, Math.max(0, r.target)),
        });
        return;
      }
      if (r.kind === "include" || r.kind === "exclude") {
        // Only accept labels the closet actually has. A hallucinated category
        // matches nothing and reads to the user as the instruction being
        // ignored, with no way to tell why.
        const raw = typeof r.category === "string" ? r.category.toLowerCase() : null;
        const category = raw ? vocab.categories.find((c) => c.toLowerCase() === raw) : undefined;
        const terms = Array.isArray(r.terms)
          ? r.terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 4)
          : [];
        if (!category && terms.length === 0) return;
        directives.push({ kind: r.kind, id: rowId, text: trimmed, category, terms });
        return;
      }
      if (r.kind === "note") directives.push({ kind: "note", id: rowId, text: trimmed });
    });

    // Understood as clothing but unmappable: keep it visibly inert rather
    // than dropping what they typed.
    if (directives.length === 0) {
      return { directives: [{ kind: "note", id, text: trimmed }], source: "ai" };
    }
    return { directives, source: "ai" };
  } catch (err) {
    // An unparsed instruction is shown back as "not applied", which is honest.
    // Failing the whole add would lose what the user typed.
    log.error("directive.parse.failed", err, { text: trimmed.slice(0, 80) });
    return { directives: [{ kind: "note", id, text: trimmed }], source: "none" };
  }
}
