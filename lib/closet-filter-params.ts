/** Parse comma-separated closet filter URL values (e.g. category=shirt,bottom). */
export function parseMultiFilterParam(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function serializeMultiFilterParam(values: readonly string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(",");
}
