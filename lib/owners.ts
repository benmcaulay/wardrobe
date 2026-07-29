import type { Owner, StylePrefs } from "@/lib/json";

/** Built-in roster seeded when a user has no owners saved yet. */
export const DEFAULT_OWNERS: Owner[] = [
  { id: "me", name: "Me", linkedUserId: null },
  { id: "her", name: "Her", linkedUserId: null },
];

/** URL/filter value for "items belonging to more than one owner". */
export const SHARED_OWNER_FILTER = "__shared__";

export function normalizeOwnerName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable id derived from a display name; falls back to "owner" for empty slugs. */
export function ownerIdFromName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "owner";
}

/** Pick an id not already used in `taken` by suffixing -2, -3, … when needed. */
export function uniqueOwnerId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function dedupeOwnersOrdered(list: readonly Owner[]): Owner[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: Owner[] = [];
  for (const raw of list) {
    const name = (raw?.name ?? "").trim();
    const nameKey = normalizeOwnerName(name);
    if (!name || seenNames.has(nameKey)) continue;
    const baseId = (raw?.id ?? "").trim() || ownerIdFromName(name);
    const id = uniqueOwnerId(baseId, seenIds);
    seenIds.add(id);
    seenNames.add(nameKey);
    out.push({ id, name, linkedUserId: raw?.linkedUserId ?? null });
  }
  return out;
}

export function sanitizeOwnersList(list: readonly Owner[]): Owner[] {
  return dedupeOwnersOrdered(list);
}

/** Single source for the owner roster shown in item forms, settings, and filters. */
export function getOwnersFromPrefs(prefs: StylePrefs): Owner[] {
  const fromPrefs = prefs.owners;
  if (Array.isArray(fromPrefs) && fromPrefs.length > 0) {
    return sanitizeOwnersList(fromPrefs);
  }
  return DEFAULT_OWNERS.map((o) => ({ ...o }));
}

/** The default owner assigned to new items (and legacy items with no owners). */
export function getPrimaryOwnerId(prefs: StylePrefs): string {
  return getOwnersFromPrefs(prefs)[0]?.id ?? DEFAULT_OWNERS[0]!.id;
}

/**
 * Owner ids for an item, treating an empty set as the primary owner so legacy
 * rows and any accidental blanks still resolve to a person for filtering.
 */
export function resolveItemOwnerIds(ids: readonly string[], primaryOwnerId: string): string[] {
  const clean = ids.map((s) => s.trim()).filter(Boolean);
  return clean.length > 0 ? clean : [primaryOwnerId];
}
