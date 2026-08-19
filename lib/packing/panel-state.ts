/**
 * Which sections of the trip page are open.
 *
 * The page grew to seven stacked cards, and most of the time you care about
 * one of them. Collapsing is only useful if it sticks, so the open/closed set
 * is remembered — keyed by section, not by trip: someone who never wants to
 * see "Day by day" doesn't want to re-collapse it on every trip they plan.
 *
 * Stored in localStorage rather than the database. It's a per-device view
 * preference, it must survive a reload but not matter if it doesn't, and it
 * should not cost a round trip or a migration.
 *
 * Pure and storage-agnostic so the merge rules can be tested directly.
 */

export const PANEL_STORAGE_KEY = "wardrobe.trip.panels.v1";

/** Fixed sections that can be collapsed, and whether they start open. */
export const PANEL_DEFAULTS: Record<string, boolean> = {
  destination: true,
  purpose: true,
  bags: true,
  gear: true,
  summary: true,
};

/**
 * Bags are collapsible too, but there's one panel per bag and their ids aren't
 * known ahead of time, so they're namespaced instead of enumerated: `bag:<id>`.
 * Anything under this prefix is accepted and defaults to open.
 */
export const BAG_PANEL_PREFIX = "bag:";

function isKnownPanel(key: string): boolean {
  return key in PANEL_DEFAULTS || key.startsWith(BAG_PANEL_PREFIX);
}

export type PanelState = Record<string, boolean>;

/**
 * Read stored state over the defaults.
 *
 * Anything unparseable, or of the wrong shape, is discarded rather than
 * repaired: a corrupt preference should hand back a working page, and the next
 * toggle rewrites the key anyway. Unknown keys are dropped so a renamed
 * section can't resurrect itself, and only booleans are honoured.
 */
export function parsePanelState(raw: string | null | undefined): PanelState {
  const state: PanelState = { ...PANEL_DEFAULTS };
  if (!raw) return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isKnownPanel(key) && typeof value === "boolean") state[key] = value;
  }
  return state;
}

/** Serialise for storage. Only known sections are written. */
export function serializePanelState(state: PanelState): string {
  const out: PanelState = {};
  for (const [key, value] of Object.entries(state)) {
    if (isKnownPanel(key) && typeof value === "boolean") out[key] = value;
  }
  return JSON.stringify(out);
}

export function togglePanel(state: PanelState, id: string): PanelState {
  const current = state[id] ?? PANEL_DEFAULTS[id] ?? true;
  return { ...state, [id]: !current };
}

export function isPanelOpen(state: PanelState, id: string): boolean {
  return state[id] ?? PANEL_DEFAULTS[id] ?? true;
}
