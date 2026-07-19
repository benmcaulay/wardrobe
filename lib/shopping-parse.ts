/** Hosts whose product URLs are aggregators, not merchant PDPs. */
export function isAggregatorProductUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "bing.com" ||
      host.endsWith(".bing.com")
    );
  } catch {
    return true;
  }
}

const GENDER_IN_TITLE =
  /\s+(?:Men'?s|Women'?s|Boys'|Girls'|Kids'|Unisex|Big\s+Boys|Big\s+Girls)\b/i;

/**
 * Best-effort brand from a Google Shopping / Lens title, e.g.
 * "Vuori Men's Sunday Performance Short" → "Vuori".
 */
export function parseBrandFromTitle(title: string): string | null {
  const t = title.trim();
  if (!t) return null;

  const beforeGender = t.split(GENDER_IN_TITLE)[0]?.trim();
  if (beforeGender && beforeGender !== t && beforeGender.length <= 48) {
    return cleanBrand(beforeGender);
  }

  for (const sep of [" - ", " – ", " | ", ": "]) {
    const idx = t.indexOf(sep);
    if (idx > 0) {
      const head = t.slice(0, idx).trim();
      if (head.length >= 2 && head.length <= 48) return cleanBrand(head);
    }
  }

  const first = t.split(/\s+/)[0];
  if (first && /^[A-Z][a-zA-Z0-9&'.]{1,}$/.test(first)) {
    return cleanBrand(first);
  }

  return null;
}

function cleanBrand(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
