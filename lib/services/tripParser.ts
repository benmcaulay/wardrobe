/**
 * Turn a free-text trip description into structured TripRequirements.
 *
 * "5 days in Lisbon for my sister's wedding, probably a beach day" → one formal
 * event, beach, no laundry. The planner never learns a model was involved: this
 * fills exactly the same structure the activity chips fill, so the AI is a
 * *parser*, not a decision-maker.
 *
 * That split is deliberate. Packing itself is a constrained optimisation
 * against hard volume and weight limits — an LLM would produce plausible bags
 * that overflow, can't be unit-tested, and cost latency on every re-plan. The
 * deterministic planner keeps that job; the model only does the thing it is
 * genuinely better at, which is reading intent out of a sentence.
 *
 * Follows the USE_REAL_* + stub convention from serpapi-client.ts and
 * weather.ts. The stub is a real keyword matcher rather than a placeholder, so
 * the feature works with no API key at all — it is also the fallback whenever
 * the model call fails, which is why it lives here and not in a test file.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  ACTIVITIES,
  EMPTY_REQUIREMENTS,
  isTripActivity,
  type TripActivity,
  type TripRequirements,
} from "@/lib/packing/requirements";

export type TripParse = {
  requirements: TripRequirements;
  /** One line describing what we understood, shown for confirmation. */
  summary: string;
  /** Where the answer came from — surfaced so the UI can be honest. */
  source: "ai" | "keywords";
  /** 0..1. Keyword matching caps low; the UI should always allow correction. */
  confidence: number;
};

export function tripParserEnabled(): boolean {
  return process.env.USE_REAL_TRIP_PARSER === "true" && !!process.env.ANTHROPIC_API_KEY;
}

/** Phrases that reliably imply an activity, for the keyless path. */
const ACTIVITY_KEYWORDS: Record<TripActivity, RegExp> = {
  beach: /(beach|swim|surf|snorkel|seaside|coast|pool|island|sunbathe)/i,
  hiking: /(hik|trek|trail|mountain|camp|backpack|climb|outdoors)/i,
  business: /(business|work trip|conference|client|meeting|office|summit|onsite)/i,
  formal: /(wedding|gala|black tie|formal|ceremony|funeral|graduation|opera|awards)/i,
  city: /(city|museum|sightsee|walking|tourist|explore|downtown|urban)/i,
  gym: /(gym|workout|run|jog|fitness|training|yoga|exercise)/i,
};

const LAUNDRY_POSITIVE = /(laundry|washing machine|can wash|do a wash|launderette|laundromat)/i;
const LAUNDRY_NEGATIVE = /(no laundry|without laundry|can't wash|cannot wash|no washing)/i;

/**
 * Keyword fallback. Deliberately conservative: it reports low confidence and
 * only claims activities whose phrasing is unambiguous, because a wrong
 * requirement silently reshapes the whole bag.
 */
export function parseTripTextWithKeywords(text: string): TripParse {
  const activities: TripActivity[] = [];
  for (const [id, pattern] of Object.entries(ACTIVITY_KEYWORDS)) {
    if (pattern.test(text) && isTripActivity(id)) activities.push(id);
  }
  const laundry = LAUNDRY_POSITIVE.test(text) && !LAUNDRY_NEGATIVE.test(text);

  const labels = activities.map(
    (a) => ACTIVITIES.find((x) => x.id === a)?.label.toLowerCase() ?? a,
  );
  const summary = activities.length
    ? `Looks like ${labels.join(", ")}${laundry ? ", with laundry" : ""}.`
    : "Couldn't pick out any activities — choose them below.";

  return {
    requirements: { activities, laundry },
    summary,
    source: "keywords",
    confidence: activities.length ? 0.45 : 0.1,
  };
}

const ACTIVITY_IDS = ACTIVITIES.map((a) => a.id);

/**
 * Schema the model must fill. `additionalProperties: false` plus `required` on
 * every field is what makes structured outputs a guarantee rather than a hope —
 * the response is validated server-side, so there is no JSON to repair here.
 */
const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["activities", "laundry", "summary"],
  properties: {
    activities: {
      type: "array",
      description:
        "Activities the trip clearly involves. Only include one when the text genuinely implies it — an empty array is a correct answer.",
      items: { type: "string", enum: ACTIVITY_IDS },
    },
    laundry: {
      type: "boolean",
      description:
        "True only if the text says laundry will be available mid-trip. Absence of any mention means false.",
    },
    summary: {
      type: "string",
      description:
        "One short sentence, addressed to the traveller, describing what you understood. No preamble.",
    },
  },
} as const;

const SYSTEM = `You read a traveller's description of an upcoming trip and extract what it implies for packing.

Only report an activity when the text genuinely implies it. A wedding means formal; "somewhere warm" on its own does not mean beach. Returning an empty list is a correct and useful answer — a wrong activity silently reshapes the whole bag, so under-claiming is much cheaper than over-claiming.

Treat laundry as available only if the text says so.`;

/**
 * Parse a trip description. Never throws: a missing key, a refusal, a network
 * failure, or a malformed reply all fall back to keyword matching, so the
 * feature degrades to the chips rather than to an error.
 */
export async function parseTripText(text: string): Promise<TripParse> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      requirements: EMPTY_REQUIREMENTS,
      summary: "",
      source: "keywords",
      confidence: 0,
    };
  }
  if (!tripParserEnabled()) return parseTripTextWithKeywords(trimmed);

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM,
      // Extraction is not intelligence-sensitive, and low effort keeps this
      // fast and cheap. Thinking stays on — disabling it on this model can leak
      // internal tags into the response.
      output_config: { effort: "low", format: { type: "json_schema", schema: PARSE_SCHEMA } },
      messages: [{ role: "user", content: trimmed }],
    });

    // Safety classifiers can decline with a normal 200; check before reading.
    if (response.stop_reason === "refusal") return parseTripTextWithKeywords(trimmed);

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return parseTripTextWithKeywords(trimmed);

    const parsed = JSON.parse(block.text) as {
      activities?: unknown;
      laundry?: unknown;
      summary?: unknown;
    };
    const activities = Array.isArray(parsed.activities)
      ? [...new Set(parsed.activities.filter((a): a is TripActivity => typeof a === "string" && isTripActivity(a)))]
      : [];

    return {
      requirements: { activities, laundry: parsed.laundry === true },
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      source: "ai",
      confidence: 0.9,
    };
  } catch {
    return parseTripTextWithKeywords(trimmed);
  }
}
