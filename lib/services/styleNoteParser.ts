/**
 * Turn a one-off styling note into structured rules.
 *
 * "don't put that hat with that shirt" → one `avoid_pair` between two specific
 * item ids. The scorer never learns a model was involved: the output is the
 * same rule shape the user could have built from a form, so the AI is a
 * *parser*, not a decision-maker.
 *
 * That split matters here more than usual. A note is an instruction — the user
 * said don't — so it is applied as a hard constraint. Anything hard has to be
 * exactly right, which means the model's job is narrowed as far as it will go:
 * it is handed the items that were on screen and asked only which of them the
 * sentence is about. It never picks items from the wider closet, never invents
 * ids, and never decides how strongly to apply anything.
 *
 * Follows the USE_REAL_* + stub convention from tripParser.ts and weather.ts.
 * The stub is a real matcher rather than a placeholder, so notes still do
 * something with no API key — and it is the fallback whenever the model call
 * fails, which is why it lives here and not in a test file.
 */
import Anthropic from "@anthropic-ai/sdk";
import { classifyGarmentKind } from "@/lib/categories";
import { isValidRule, type StyleRule } from "@/lib/outfit/style-rules";
import { OCCASIONS } from "@/lib/wear/occasions";

/** An item that was on screen when the note was written. */
export type NoteSubject = {
  id: string;
  name: string;
  category: string;
};

export type NoteParse = {
  rules: StyleRule[];
  /** One line describing what we understood, shown back for confirmation. */
  summary: string;
  source: "ai" | "keywords";
};

export function styleNoteParserEnabled(): boolean {
  return process.env.USE_REAL_STYLE_NOTES === "true" && !!process.env.ANTHROPIC_API_KEY;
}

const NEGATION = /\b(don'?t|do not|never|stop|avoid|no more|not with|hate|dislike)\b/i;
const PREFERENCE = /\b(love|great with|goes with|always|prefer|looks good with|pair)\b/i;

/**
 * Keyword fallback.
 *
 * Notes name garments the way people talk — "that hat", "the green shirt" — so
 * this matches the words in the note against the *on-screen* items by kind and
 * by name, then uses the count of matches to pick a rule shape. Deliberately
 * conservative: it emits nothing unless the sentence clearly points at one or
 * two visible items, because a wrong hard constraint silently removes outfits
 * the user never asked to lose.
 */
/**
 * Garment words that name a *kind* rather than a specific piece. A note built
 * only from these is a habit ("I don't wear boots with shorts"), not a remark
 * about the two things on screen.
 */
const KIND_TERMS = [
  "boots", "sneakers", "trainers", "sandals", "heels", "loafers", "flip flops", "slides",
  "shorts", "jeans", "trousers", "pants", "chinos", "joggers", "sweatpants", "skirt", "leggings",
  "hats", "caps", "beanie", "hoodies", "sweaters", "blazers", "jackets", "coats", "suits",
  "tees", "t-shirts", "shirts", "polos", "tanks", "dresses", "socks",
];

export function parseStyleNoteWithKeywords(text: string, subjects: NoteSubject[]): NoteParse {
  const lower = text.toLowerCase();

  // Kind-vs-kind first: "boots with shorts" is a rule about categories, and
  // resolving it to whichever two garments happen to be on screen would both
  // under-apply it today and miss every future purchase.
  const kindHits = KIND_TERMS.filter((term) => new RegExp(`\\b${term.replace(/[-\s]/g, "[-\\s]?")}\\b`).test(lower));
  const negatedText = NEGATION.test(text);
  if (kindHits.length === 2 && (negatedText || PREFERENCE.test(text))) {
    const terms: [string, string] = [singular(kindHits[0]), singular(kindHits[1])];
    return {
      rules: [{ kind: negatedText ? "avoid_term_pair" : "prefer_term_pair", terms }],
      summary: `${negatedText ? "No" : "Yes to"} ${terms[0]} with ${terms[1]}.`,
      source: "keywords",
    };
  }

  const matched = subjects.filter((subject) => {
    const kind = classifyGarmentKind(subject);
    if (kind !== "other" && new RegExp(`\\b${kind}s?\\b`).test(lower)) return true;
    if (new RegExp(`\\b${escapeRegex(subject.category.toLowerCase())}s?\\b`).test(lower)) return true;
    // Distinctive words from the item's own name ("Hanalei", "Momotaro").
    return subject.name
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 5)
      .some((word) => lower.includes(word));
  });

  const negative = NEGATION.test(text);
  const positive = !negative && PREFERENCE.test(text);
  if (!negative && !positive) return { rules: [], summary: "", source: "keywords" };

  if (matched.length === 2) {
    const pair: [string, string] = [matched[0].id, matched[1].id];
    return {
      rules: [{ kind: negative ? "avoid_pair" : "prefer_pair", itemIds: pair }],
      summary: `${negative ? "Won't" : "Will"} put ${matched[0].name} with ${matched[1].name}.`,
      source: "keywords",
    };
  }
  if (matched.length === 1 && negative) {
    return {
      rules: [{ kind: "avoid_item", itemId: matched[0].id }],
      summary: `Won't suggest ${matched[0].name}.`,
      source: "keywords",
    };
  }

  return { rules: [], summary: "", source: "keywords" };
}

/** "boots" → "boot", so the term matcher's optional plural does the work. */
function singular(term: string): string {
  return term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cap on how many garments go into one prompt.
 *
 * The contextual box passes three or four. The general tip box passes the whole
 * wardrobe, which is where this matters: a very large list both costs tokens and
 * makes a confident resolution less likely, so it is truncated and the parser is
 * told that an unresolvable reference should produce nothing.
 */
const MAX_SUBJECTS = 250;

const SYSTEM = `You convert a single short styling note into structured rules for a wardrobe app.

You are given the garments in scope. Demonstratives like "that hat" or "these jeans" refer to those garments — resolve them to ids from the provided list.

Rules:
- Only ever use itemIds from the provided list. Never invent an id.
- If the note is a general rule about KINDS of garment rather than specific ones — "I don't wear boots with shorts", "no hats with hoodies" — emit avoid_term_pair with the two garment words, lowercase and singular-or-plural as written. Do NOT enumerate matching items as avoid_pair: a kind rule must apply to garments bought later too. Mirror with prefer_term_pair for positive general rules.
- Prefer avoid_pair (specific ids) when the note points at particular garments, and avoid_term_pair when it states a habit.
- If the note is negative about two garments together, emit avoid_pair.
- If the note is negative about one garment generally, emit avoid_item.
- If the note is negative about one garment only in some weather or occasion, emit avoid_item_context with the relevant bands/occasions.
- Mirror those with prefer_pair / prefer_item_context for positive notes.
- If the note is vague, is about something other than these garments, or you cannot confidently resolve which garment it means, return an empty rules array. An empty result is correct and expected; a wrong rule silently removes outfits the user never asked to lose.
- summary: one short sentence, in plain language, restating the rule for the user to confirm.`;

const PARSE_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "avoid_pair",
              "prefer_pair",
              "avoid_item",
              "avoid_item_context",
              "prefer_item_context",
              "avoid_term_pair",
              "prefer_term_pair",
            ],
          },
          itemIds: { type: "array", items: { type: "string" } },
          terms: { type: "array", items: { type: "string" } },
          itemId: { type: "string" },
          bands: {
            type: "array",
            items: { type: "string", enum: ["hot", "warm", "mild", "cool", "cold"] },
          },
          occasions: { type: "array", items: { type: "string", enum: [...OCCASIONS] } },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["rules", "summary"],
  additionalProperties: false,
} as const;

/**
 * Parse one note. Never throws: a missing key, a refusal, a network failure, or
 * a malformed reply all fall back to keyword matching, so a note degrades to a
 * simpler rule — or to none — rather than to an error in the user's face.
 */
export async function parseStyleNote(
  text: string,
  subjects: NoteSubject[],
): Promise<NoteParse> {
  const trimmed = text.trim();
  if (!trimmed || subjects.length === 0) {
    return { rules: [], summary: "", source: "keywords" };
  }
  if (!styleNoteParserEnabled()) return parseStyleNoteWithKeywords(trimmed, subjects);

  const known = new Set(subjects.map((s) => s.id));

  try {
    const scoped = subjects.slice(0, MAX_SUBJECTS);
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM,
      // Resolving one demonstrative against three or four visible garments is
      // not intelligence-sensitive, and low effort keeps it fast enough to run
      // inline. Thinking stays on — disabling it on this model can leak
      // internal tags into the response.
      output_config: { effort: "low", format: { type: "json_schema", schema: PARSE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            "Garments on screen:",
            ...scoped.map((s) => `- id=${s.id} | ${s.name} (${s.category})`),
            "",
            `Note: ${trimmed}`,
          ].join("\n"),
        },
      ],
    });

    // Safety classifiers can decline with a normal 200; check before reading.
    if (response.stop_reason === "refusal") return parseStyleNoteWithKeywords(trimmed, subjects);

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return parseStyleNoteWithKeywords(trimmed, subjects);

    const parsed = JSON.parse(block.text) as { rules?: unknown; summary?: unknown };
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.filter((rule): rule is StyleRule => isValidRule(rule, known))
      : [];

    // The model returned something, but nothing survived validation — most
    // likely a hallucinated id. Prefer the keyword matcher's honest guess over
    // silently dropping the user's note.
    if (rules.length === 0 && Array.isArray(parsed.rules) && parsed.rules.length > 0) {
      return parseStyleNoteWithKeywords(trimmed, subjects);
    }

    return {
      rules,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      source: "ai",
    };
  } catch {
    return parseStyleNoteWithKeywords(trimmed, subjects);
  }
}
