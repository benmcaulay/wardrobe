import { isNoneCategoryStored, normalizeCategoryName } from "@/lib/categories";
import { parseColors } from "@/lib/json";

function normalizeColorKey(colorsJson: string): string {
  const name = parseColors(colorsJson)[0]?.name ?? "";
  return name.trim().toLowerCase();
}

/** Stable key for items sharing category + primary (★) color. */
export function closetGroupKey(category: string, colorsJson: string): string {
  const cat = isNoneCategoryStored(category) ? "" : normalizeCategoryName(category);
  const color = normalizeColorKey(colorsJson);
  return `${cat}\0${color}`;
}

export function itemsShareClosetGroup(
  a: { category: string; colors: string },
  b: { category: string; colors: string },
): boolean {
  return closetGroupKey(a.category, a.colors) === closetGroupKey(b.category, b.colors);
}

export function compareClosetGroupOrder(
  aId: string,
  bId: string,
  groupKey: string,
  orders?: Record<string, readonly string[]>,
): number {
  const order = orders?.[groupKey];
  if (!order?.length) return 0;
  const ia = order.indexOf(aId);
  const ib = order.indexOf(bId);
  const aIdx = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
  const bIdx = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
  if (aIdx !== bIdx) return aIdx - bIdx;
  return 0;
}

export function reorderIdList(ids: readonly string[], fromId: string, toId: string): string[] | null {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1 || from === to) return null;
  const next = [...ids];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
}

export function groupItemIds<T extends { id: string; category: string; colors: string }>(
  items: readonly T[],
  groupKey: string,
): string[] {
  return items.filter((i) => closetGroupKey(i.category, i.colors) === groupKey).map((i) => i.id);
}

/** Rewrite closet group-order keys when a category is renamed. */
export function migrateClosetGroupOrderCategory(
  orders: Record<string, string[]> | undefined,
  oldCategoryNorm: string,
  newCategoryNorm: string,
): Record<string, string[]> | undefined {
  if (!orders) return orders;
  if (!oldCategoryNorm || oldCategoryNorm === newCategoryNorm) return orders;
  const next: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(orders)) {
    const sep = key.indexOf("\0");
    const cat = sep === -1 ? key : key.slice(0, sep);
    const color = sep === -1 ? "" : key.slice(sep + 1);
    const migratedCat = cat === oldCategoryNorm ? newCategoryNorm : cat;
    next[`${migratedCat}\0${color}`] = ids;
  }
  return next;
}
