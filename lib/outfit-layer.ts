/** Swap z-order of `selectedId` with its neighbor in the stack (dir -1 = back, +1 = forward). */
export function swapLayerOrder<T extends { id: string; z: number }>(
  items: readonly T[],
  selectedId: string,
  dir: -1 | 1,
): T[] | null {
  const sorted = [...items].sort((a, b) => a.z - b.z);
  const idx = sorted.findIndex((item) => item.id === selectedId);
  const nextIdx = idx + dir;
  if (idx < 0 || nextIdx < 0 || nextIdx >= sorted.length) return null;
  const a = sorted[idx]!;
  const b = sorted[nextIdx]!;
  return items.map((item) => {
    if (item.id === a.id) return { ...item, z: b.z };
    if (item.id === b.id) return { ...item, z: a.z };
    return item;
  });
}
