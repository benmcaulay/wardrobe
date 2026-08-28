/**
 * Wardrobe categories as a tree.
 *
 * Closets nest naturally — "t shirt" and "flannel" are both kinds of "shirt",
 * "boot" and "sneaker" are both "shoes" — and a flat list forces a choice
 * between the general label and the specific one. The old answer to that was a
 * bulk "reassign pieces" picker: add the narrow category, then hand-move the
 * pieces across. Nesting replaces the problem rather than the chore. The narrow
 * category lives *under* the broad one, and filtering by the parent still finds
 * everything beneath it.
 *
 * ── How it is stored ────────────────────────────────────────────────────────
 *
 * Two pieces of state, both already the shape prefs use:
 *
 *   - `categoriesList`: the flat, ordered list of every category. Unchanged.
 *   - `categoryParents`: normalised child name → normalised parent name.
 *
 * Deliberately *not* a nested structure on disk, and deliberately nothing on
 * the items. An item's `category` is still one plain label — the label it
 * always was — so nesting adds no migration, and every existing reader
 * (classifier, packing buckets, outfit slots, the group order) keeps working
 * without knowing this file exists. A parent is a fact about the *label*, not
 * about the garment.
 *
 * The list doubles as the display order: it is kept in pre-order (a parent
 * immediately followed by its subtree) after any move, but nothing here
 * *assumes* that — a list that isn't in pre-order still builds a correct tree,
 * which is what makes the first save after this feature ships harmless.
 */

import { getCategoriesListFromPrefs, normalizeCategoryName } from "@/lib/categories";
import type { StylePrefs } from "@/lib/json";

/** Normalised child → normalised parent. */
export type CategoryParents = Record<string, string>;

export type CategoryNode = {
  /** The label, with the user's own casing. */
  name: string;
  /** Normalised form — the key used by `CategoryParents` and shapes. */
  key: string;
  children: CategoryNode[];
};

/** One row of a tree flattened for rendering. */
export type CategoryRow = {
  name: string;
  key: string;
  depth: number;
  /** Normalised parent, or null at the root. */
  parentKey: string | null;
  /** True when this row has children — the caller draws the twisty. */
  hasChildren: boolean;
};

/**
 * Drop `categoryParents` entries that can't be honoured.
 *
 * Runs on read as well as write, because the list can change underneath the map
 * in ways no single action controls: a category removed on another device, a
 * legacy pref, an edited export. An unresolvable parent silently promotes its
 * child to the root, which is the safe direction — the alternative is a
 * category that exists but renders nowhere.
 *
 * Cycles are broken at the edge that closes them. They cannot be produced by
 * `moveCategory`, which refuses them, but they *can* arrive in stored data, and
 * a cycle here would hang every renderer that walks the tree.
 */
export function sanitizeCategoryParents(
  parents: CategoryParents | null | undefined,
  list: readonly string[],
): CategoryParents {
  if (!parents) return {};
  const known = new Set(list.map(normalizeCategoryName).filter(Boolean));
  const candidate: CategoryParents = {};
  for (const [rawChild, rawParent] of Object.entries(parents)) {
    const child = normalizeCategoryName(rawChild);
    const parent = normalizeCategoryName(rawParent ?? "");
    if (!child || !parent || child === parent) continue;
    if (!known.has(child) || !known.has(parent)) continue;
    candidate[child] = parent;
  }

  const out: CategoryParents = {};
  for (const [child, parent] of Object.entries(candidate)) {
    const seen = new Set<string>([child]);
    let cursor: string | undefined = parent;
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor)) {
        cyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = candidate[cursor];
    }
    if (!cyclic) out[child] = parent;
  }
  return out;
}

/**
 * Build the tree.
 *
 * Children keep the order they appear in `list`, and a node whose parent is
 * missing from the list becomes a root. Parents are read from the sanitized
 * map, so a caller cannot hand this a cycle.
 */
export function buildCategoryTree(
  list: readonly string[],
  parents: CategoryParents | null | undefined,
): CategoryNode[] {
  const clean = sanitizeCategoryParents(parents, list);
  const nodes = new Map<string, CategoryNode>();
  const order: string[] = [];
  for (const raw of list) {
    const name = raw.trim();
    const key = normalizeCategoryName(name);
    if (!key || nodes.has(key)) continue;
    nodes.set(key, { name, key, children: [] });
    order.push(key);
  }

  const roots: CategoryNode[] = [];
  for (const key of order) {
    const node = nodes.get(key)!;
    const parentKey = clean[key];
    const parent = parentKey ? nodes.get(parentKey) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Pre-order rows: every parent immediately before its own subtree. */
export function flattenCategoryTree(
  tree: readonly CategoryNode[],
  depth = 0,
  parentKey: string | null = null,
): CategoryRow[] {
  const out: CategoryRow[] = [];
  for (const node of tree) {
    out.push({
      name: node.name,
      key: node.key,
      depth,
      parentKey,
      hasChildren: node.children.length > 0,
    });
    out.push(...flattenCategoryTree(node.children, depth + 1, node.key));
  }
  return out;
}

/** The list in pre-order — what gets stored after a move. */
export function categoryListFromTree(tree: readonly CategoryNode[]): string[] {
  return flattenCategoryTree(tree).map((row) => row.name);
}

/** Every category under `key`, deepest included, excluding `key` itself. */
export function descendantKeys(
  key: string,
  parents: CategoryParents | null | undefined,
  list: readonly string[],
): string[] {
  const clean = sanitizeCategoryParents(parents, list);
  const wanted = normalizeCategoryName(key);
  const byParent = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(clean)) {
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(child);
  }
  const out: string[] = [];
  const queue = [...(byParent.get(wanted) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    queue.push(...(byParent.get(next) ?? []));
  }
  return out;
}

/**
 * A category and everything above it: `[self, parent, grandparent, …]`.
 *
 * This is how nesting reaches the outfit generator. Rather than widening a
 * *rule* ("shirt" also means "t shirt"), which would change the category
 * signatures the slot machinery keys every saved position and size off, the
 * *item* is widened: a piece filed under "t shirt" counts as a t shirt, a
 * shirt, and a top. Same matches, no effect on layout.
 *
 * Labels come from `list` where they exist, so the result reads in the user's
 * own casing; a category not in the list still returns itself, since an item
 * can be filed under a label the list has since lost.
 */
export function categoryAncestryPath(
  category: string,
  parents: CategoryParents | null | undefined,
  list: readonly string[],
): string[] {
  const self = (category ?? "").trim();
  const key = normalizeCategoryName(self);
  if (!key) return [];
  const clean = sanitizeCategoryParents(parents, list);
  const label = (k: string) => list.find((c) => normalizeCategoryName(c) === k) ?? k;

  const out = [list.find((c) => normalizeCategoryName(c) === key) ?? self];
  const seen = new Set<string>([key]);
  let cursor: string | undefined = clean[key];
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    out.push(label(cursor));
    cursor = clean[cursor];
  }
  return out;
}

/** True when `maybeAncestor` is at or above `key`. Guards against cycles. */
export function isAncestorOf(
  maybeAncestor: string,
  key: string,
  parents: CategoryParents | null | undefined,
  list: readonly string[],
): boolean {
  const clean = sanitizeCategoryParents(parents, list);
  const target = normalizeCategoryName(maybeAncestor);
  let cursor: string | undefined = clean[normalizeCategoryName(key)];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === target) return true;
    seen.add(cursor);
    cursor = clean[cursor];
  }
  return false;
}

/** Where a dragged category lands. */
export type CategoryDropMode =
  /** Same level as the target, immediately before it. The old reorder. */
  | "sibling"
  /**
   * Same level as the target, immediately after it. Only the list's trailing
   * drop strip uses this, and only because "before" alone cannot express "make
   * this the last top-level category" — the one position the old index-based
   * reorder could reach and a before-only rule cannot.
   */
  | "after"
  /** Last child of the target. What dropping on a row's right half does. */
  | "child";

export type CategoryMove = {
  /** Next flat list, in pre-order. */
  list: string[];
  parents: CategoryParents;
  /** False when the move was refused; the two fields above are then unchanged. */
  moved: boolean;
};

/**
 * Move a category, subtree and all.
 *
 * Refused, rather than silently adjusted, when the move makes no sense: onto
 * itself, onto its own descendant (which would detach the subtree from the tree
 * entirely), or naming a category that isn't in the list.
 *
 * A "sibling" drop lands *before* the target regardless of which direction the
 * drag came from. The old flat list used an index-based splice, where dragging
 * downward landed after the target and upward landed before it — the same
 * gesture meaning two things depending on where you started.
 */
export function moveCategory(
  list: readonly string[],
  parents: CategoryParents | null | undefined,
  draggedName: string,
  targetName: string,
  mode: CategoryDropMode,
): CategoryMove {
  const clean = sanitizeCategoryParents(parents, list);
  const unchanged: CategoryMove = { list: [...list], parents: clean, moved: false };

  const dragged = normalizeCategoryName(draggedName);
  const target = normalizeCategoryName(targetName);
  if (!dragged || !target || dragged === target) return unchanged;

  const known = new Map(list.map((raw) => [normalizeCategoryName(raw), raw.trim()]));
  if (!known.has(dragged) || !known.has(target)) return unchanged;
  if (isAncestorOf(dragged, target, clean, list)) return unchanged;

  const nextParents: CategoryParents = { ...clean };
  if (mode === "child") {
    nextParents[dragged] = target;
  } else {
    const targetParent = clean[target];
    if (targetParent) nextParents[dragged] = targetParent;
    else delete nextParents[dragged];
  }

  // Rebuild the flat order by walking the tree the new parents describe, so the
  // subtree travels with its root and the result is pre-order by construction.
  const tree = buildCategoryTree(list, nextParents);
  const ordered = orderTree(tree, dragged, target, mode);
  return { list: categoryListFromTree(ordered), parents: nextParents, moved: true };
}

/**
 * Place the dragged node among its new siblings.
 *
 * `buildCategoryTree` puts it wherever the *old* list happened to have it,
 * which is right for every other node and arbitrary for this one. Only the
 * level holding the dragged node needs touching.
 */
function orderTree(
  tree: readonly CategoryNode[],
  dragged: string,
  target: string,
  mode: CategoryDropMode,
): CategoryNode[] {
  return placeIn(tree, null);

  function placeIn(level: readonly CategoryNode[], parentKey: string | null): CategoryNode[] {
    const rebuilt = level.map((node) => ({
      ...node,
      children: placeIn(node.children, node.key),
    }));
    const from = rebuilt.findIndex((n) => n.key === dragged);
    if (from < 0) return rebuilt;

    const [node] = rebuilt.splice(from, 1);
    if (mode === "child" && parentKey === target) {
      // Last child, so a category dropped onto a parent appears at the bottom
      // of its list rather than jumping to the top of it.
      rebuilt.push(node!);
      return rebuilt;
    }
    const at = rebuilt.findIndex((n) => n.key === target);
    if (at < 0) rebuilt.push(node!);
    else rebuilt.splice(mode === "after" ? at + 1 : at, 0, node!);
    return rebuilt;
  }
}

/**
 * Add a category, optionally inside another one.
 *
 * Separate from `moveCategory` because adding has its own refusals — a blank
 * name, a name already taken, a parent that isn't there — and the settings page
 * needs to tell those apart to say something useful. `moved` is false for all
 * of them, with the list and map unchanged.
 *
 * A new child lands last among its siblings, the same place a dragged one does.
 */
export function addCategoryUnder(
  list: readonly string[],
  parents: CategoryParents | null | undefined,
  rawName: string,
  parentName?: string | null,
): CategoryMove {
  const clean = sanitizeCategoryParents(parents, list);
  const unchanged: CategoryMove = { list: [...list], parents: clean, moved: false };

  const name = (rawName ?? "").trim();
  const key = normalizeCategoryName(name);
  if (!key) return unchanged;
  if (list.some((c) => normalizeCategoryName(c) === key)) return unchanged;

  const parentKey = normalizeCategoryName(parentName ?? "");
  if (parentName && !list.some((c) => normalizeCategoryName(c) === parentKey)) return unchanged;

  const grown = [...list, name];
  if (!parentKey) return { list: grown, parents: clean, moved: true };
  return moveCategory(grown, clean, name, parentKey, "child");
}

/**
 * Promote a removed category's children to its own level.
 *
 * Without this, removing "shirt" would orphan "t shirt" — which sanitizing
 * turns into a root anyway, but by accident and one save later. Doing it here
 * keeps the map honest at the moment of the change.
 */
export function parentsAfterRemoval(
  parents: CategoryParents | null | undefined,
  list: readonly string[],
  removedName: string,
): CategoryParents {
  const clean = sanitizeCategoryParents(parents, list);
  const removed = normalizeCategoryName(removedName);
  if (!removed) return clean;
  const grandparent = clean[removed];
  const out: CategoryParents = {};
  for (const [child, parent] of Object.entries(clean)) {
    if (child === removed) continue;
    if (parent === removed) {
      if (grandparent) out[child] = grandparent;
      continue;
    }
    out[child] = parent;
  }
  return out;
}

/** Rewire the map when a category is renamed, on both sides of the edge. */
export function parentsAfterRename(
  parents: CategoryParents | null | undefined,
  list: readonly string[],
  fromName: string,
  toName: string,
): CategoryParents {
  const clean = sanitizeCategoryParents(parents, list);
  const from = normalizeCategoryName(fromName);
  const to = normalizeCategoryName(toName);
  if (!from || !to || from === to) return clean;
  const out: CategoryParents = {};
  for (const [child, parent] of Object.entries(clean)) {
    const nextChild = child === from ? to : child;
    const nextParent = parent === from ? to : parent;
    if (nextChild === nextParent) continue;
    out[nextChild] = nextParent;
  }
  return out;
}

/**
 * Filter a tree by a search query, nesting preserved.
 *
 * Three rules, and the second two are the point of searching a tree rather than
 * a list:
 *
 *   - A node that matches is kept *with its whole subtree*, so searching
 *     "shoes" shows what's under shoes.
 *   - A node whose descendant matches is kept as a path to it, so a deep match
 *     is not shown floating without its context.
 *   - An empty query keeps everything.
 */
export function searchCategoryTree(
  tree: readonly CategoryNode[],
  query: string,
): CategoryNode[] {
  const needle = normalizeCategoryName(query);
  if (!needle) return tree.map(cloneNode);
  const out: CategoryNode[] = [];
  for (const node of tree) {
    if (node.key.includes(needle)) {
      out.push(cloneNode(node));
      continue;
    }
    const children = searchCategoryTree(node.children, query);
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

function cloneNode(node: CategoryNode): CategoryNode {
  return { ...node, children: node.children.map(cloneNode) };
}

/** The nesting map from prefs, cleaned against the list it refers to. */
export function getCategoryParentsFromPrefs(prefs: StylePrefs): CategoryParents {
  return sanitizeCategoryParents(prefs.categoryParents, getCategoriesListFromPrefs(prefs));
}

/** The user's categories as a tree, straight from prefs. */
export function getCategoryTreeFromPrefs(prefs: StylePrefs): CategoryNode[] {
  const list = getCategoriesListFromPrefs(prefs);
  return buildCategoryTree(list, sanitizeCategoryParents(prefs.categoryParents, list));
}

/**
 * ── Category pickers ────────────────────────────────────────────────────────
 *
 * A picker (the closet's Category filter today) shows the same tree, but its
 * rows are already flat by the time they reach the client and its values are
 * not always category names — the closet has an "uncategorized" pseudo-option.
 * So pickers get a flat row shape carrying the two things nesting adds: how
 * deep to indent, and what else is beneath.
 */
export type CategoryOptionRow = {
  /** Filter value. A category label, or a sentinel like the None bucket. */
  value: string;
  label: string;
  depth: number;
  /** Values of every row beneath this one, deepest included. */
  descendants: string[];
};

/**
 * Search flat picker rows, keeping the nesting legible.
 *
 * Same three rules as `searchCategoryTree` — a match keeps its subtree, a match
 * keeps its ancestors as the path to it, an empty query keeps everything —
 * expressed over rows instead of nodes, since that is what a picker holds.
 */
export function searchCategoryOptionRows(
  rows: readonly CategoryOptionRow[],
  query: string,
): CategoryOptionRow[] {
  const needle = normalizeCategoryName(query);
  if (!needle) return [...rows];

  const matched = new Set<string>();
  for (const row of rows) {
    if (normalizeCategoryName(row.label).includes(needle)) matched.add(row.value);
  }
  if (matched.size === 0) return [];

  const keep = new Set<string>(matched);
  for (const row of rows) {
    // An ancestor of a match: keep it, so the match is shown in place.
    if (row.descendants.some((d) => matched.has(d))) keep.add(row.value);
    // A descendant of a match: keep it, so a matched parent shows its subtree.
    if (matched.has(row.value)) for (const d of row.descendants) keep.add(d);
  }
  return rows.filter((row) => keep.has(row.value));
}

/**
 * Toggle a picker row, subtree included.
 *
 * Selecting "shirt" means "shirts, including the kinds of shirt" — that is the
 * point of nesting, and the alternative (parent selects only pieces labelled
 * exactly "shirt") would make nesting a purely decorative indent. Order is
 * preserved so the filter's summary text stays stable.
 */
export function toggleCategoryOptionRow(
  selected: readonly string[],
  row: CategoryOptionRow,
): string[] {
  const subtree = [row.value, ...row.descendants];
  const isOn = selected.includes(row.value);
  if (isOn) {
    const drop = new Set(subtree);
    return selected.filter((v) => !drop.has(v));
  }
  const next = [...selected];
  for (const value of subtree) if (!next.includes(value)) next.push(value);
  return next;
}
