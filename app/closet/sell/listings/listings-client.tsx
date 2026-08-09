"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { imageUrl } from "@/lib/image-paths";
import { MARKETPLACES } from "@/lib/marketplaces";
import {
  CONDITION_OPTIONS,
  buildListingDraft,
  daysBetween,
  formatCents,
  formatRate,
  isStaleListing,
  STALE_AFTER_DAYS,
  listingClipboardText,
  sellThroughInsight,
  suggestedAskingCents,
  summarizeListings,
  type ItemCondition,
  type ListingItemInput,
  type SaleStatus,
} from "@/lib/sale-listing";
import { fadeUp, listItem, springSoft, staggerContainer } from "@/lib/ui-motion";
import {
  bulkRemoveSaleListings,
  bulkSetSaleStatus,
  removeSaleListing,
  setSaleStatus,
  updateSaleListing,
} from "../actions";

export type Listing = {
  itemId: string;
  status: string;
  askingCents: number | null;
  soldPriceCents: number | null;
  currency: string;
  condition: ItemCondition | null;
  title: string;
  description: string;
  marketplaces: string[];
  retailCents: number | null;
  categoryLabel: string;
  imagePath: string;
  updatedAtMs: number;
  item: ListingItemInput;
};

const STATUS_ORDER: SaleStatus[] = ["for_sale", "listed", "sold"];

type Filter = "all" | "for_sale" | "listed" | "sold";

/** Download a zip of listing.txt + photos for the selected item ids. */
async function downloadExportBundle(itemIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (itemIds.length === 0) return { ok: false, error: "Nothing selected" };
  try {
    const res = await fetch("/api/sell/export-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `Export failed (${res.status})` };
    }
    const blob = await res.blob();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename =
      itemIds.length === 1
        ? `listing-export-${stamp}.zip`
        : `listings-export-${itemIds.length}-${stamp}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

export function ListingsClient({ initial }: { initial: Listing[] }) {
  const [listings, setListings] = useState<Listing[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Stable "now" for staleness; one read per mount avoids hydration drift.
  const [nowMs] = useState(() => Date.now());

  const summary = summarizeListings(listings);
  const insight = sellThroughInsight(listings);
  const staleCount = listings.filter((l) => isStaleListing(l, nowMs)).length;

  if (listings.length === 0) {
    return (
      <div className="rounded-3xl border border-ink/10 bg-paper-warm p-12 text-center">
        <p className="font-serif text-2xl">Nothing listed yet.</p>
        <p className="mt-2 text-ink-muted">Sort through your closet to pick what goes up.</p>
        <Link
          href="/closet/sell/triage"
          className="mt-6 inline-block rounded-full bg-ink px-6 py-2.5 text-sm tracking-wide text-paper transition hover:bg-ink-soft"
        >
          Sell or keep
        </Link>
      </div>
    );
  }

  function patch(itemId: string, next: Partial<Pick<Listing, "status" | "askingCents" | "soldPriceCents">>) {
    setListings((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, ...next } : l)));
  }

  function toggleSelect(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function bulkStatus(status: SaleStatus) {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const res = await bulkSetSaleStatus({ itemIds: ids, status });
    if (res.ok) {
      const now = Date.now();
      setListings((prev) =>
        prev.map((l) =>
          selected.has(l.itemId) ? { ...l, status, soldPriceCents: null, updatedAtMs: now } : l,
        ),
      );
      setSelected(new Set());
    }
    setBusy(false);
  }

  async function bulkRemove() {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const res = await bulkRemoveSaleListings(ids);
    if (res.ok) {
      setListings((prev) => prev.filter((l) => !selected.has(l.itemId)));
      setSelected(new Set());
    }
    setBusy(false);
  }

  async function bulkExport() {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setExportError(null);
    const res = await downloadExportBundle(ids);
    if (!res.ok) setExportError(res.error);
    setBusy(false);
  }

  const ordered = [...listings].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status as SaleStatus) - STATUS_ORDER.indexOf(b.status as SaleStatus),
  );
  const visible = filter === "all" ? ordered : ordered.filter((l) => l.status === filter);

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: summary.activeCount + summary.soldCount },
    { id: "for_sale", label: "For sale", count: summary.forSaleCount },
    { id: "listed", label: "Listed", count: summary.listedCount },
    { id: "sold", label: "Sold", count: summary.soldCount },
  ];

  const reduce = useReducedMotion();

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <motion.dl variants={fadeUp} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Active"
          value={String(summary.activeCount)}
          sub={`${formatCents(summary.activeAskingCents, summary.currency)} asking`}
        />
        <Stat
          label="Sold"
          value={String(summary.soldCount)}
          sub={`${formatCents(summary.soldValueCents, summary.currency)} value`}
        />
        <Stat
          label="Potential"
          value={formatCents(summary.activeAskingCents + summary.soldValueCents, summary.currency) || "$0"}
          sub="asking + sold"
        />
      </motion.dl>

      {insight.realizedCount > 0 && (
        <motion.div
          variants={fadeUp}
          className="rounded-2xl border border-ink/10 bg-paper-warm px-4 py-3"
        >
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">
            Sell-through insight · {insight.realizedCount}{" "}
            {insight.realizedCount === 1 ? "sale" : "sales"}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {insight.realizedRate != null && (
              <span>
                Sells at <span className="font-medium">{formatRate(insight.realizedRate)}</span> of
                asking
              </span>
            )}
            {insight.recoveryRate != null && (
              <span>
                Recovers <span className="font-medium">{formatRate(insight.recoveryRate)}</span> of
                retail
              </span>
            )}
            {insight.sellThroughRate != null && (
              <span>
                <span className="font-medium">{formatRate(insight.sellThroughRate)}</span>{" "}
                sell-through
              </span>
            )}
            {insight.avgDiscountCents != null && insight.avgDiscountCents !== 0 && (
              <span className="text-ink-muted">
                {insight.avgDiscountCents > 0 ? "−" : "+"}
                {formatCents(Math.abs(insight.avgDiscountCents), summary.currency)} vs asking avg
              </span>
            )}
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            aria-pressed={filter === t.id}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              filter === t.id
                ? "border-ink bg-ink text-paper"
                : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </motion.div>

      {staleCount > 0 && (
        <p className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {staleCount} {staleCount === 1 ? "listing hasn't" : "listings haven't"} moved in{" "}
          {STALE_AFTER_DAYS}+ days. Consider a price drop or a new marketplace.
        </p>
      )}

      {(() => {
        const selectableVisible = visible.filter((l) => l.status !== "sold");
        const allSelected =
          selectableVisible.length > 0 && selectableVisible.every((l) => selected.has(l.itemId));
        if (selectableVisible.length === 0 && selected.size === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/10 bg-white px-3 py-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) selectableVisible.forEach((l) => next.add(l.itemId));
                    else selectableVisible.forEach((l) => next.delete(l.itemId));
                    return next;
                  })
                }
                className="accent-ink"
              />
              Select {filter === "all" ? "all" : "shown"}
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-ink-muted">{selected.size} selected</span>
                <span className="mx-1 h-4 w-px bg-ink/10" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => bulkStatus("listed")}
                  className="rounded-full border border-ink/15 px-3 py-1 transition hover:bg-paper-warm disabled:opacity-50"
                >
                  Mark listed
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => bulkStatus("for_sale")}
                  className="rounded-full border border-ink/15 px-3 py-1 transition hover:bg-paper-warm disabled:opacity-50"
                >
                  Back to for sale
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={bulkExport}
                  className="rounded-full border border-ink/15 px-3 py-1 transition hover:bg-paper-warm disabled:opacity-50"
                >
                  Export bundle
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={bulkRemove}
                  className="rounded-full px-3 py-1 text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="ml-auto text-ink-muted underline hover:text-ink"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        );
      })()}

      {exportError && (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {exportError}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-ink/10 bg-paper-warm p-8 text-center text-sm text-ink-muted">
          Nothing in this view.
        </p>
      ) : (
        <motion.ul className="space-y-5" layout={!reduce} key={filter}>
          <AnimatePresence mode="popLayout">
            {visible.map((listing) => (
              <ListingCard
                key={listing.itemId}
                listing={listing}
                realizedRate={insight.realizedRate}
                nowMs={nowMs}
                selected={selected.has(listing.itemId)}
                onToggleSelect={toggleSelect}
                onRemoved={(id) => setListings((prev) => prev.filter((l) => l.itemId !== id))}
                onPatch={patch}
              />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </motion.div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <motion.div
      className="rounded-2xl border border-ink/10 bg-white p-4"
      whileHover={{ y: -2, transition: springSoft }}
    >
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 font-serif text-2xl tracking-tight">{value}</dd>
      <dd className="text-[11px] text-ink-muted">{sub}</dd>
    </motion.div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function dollarsToCents(value: string): number | null {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function ListingCard({
  listing,
  realizedRate,
  nowMs,
  selected,
  onToggleSelect,
  onRemoved,
  onPatch,
}: {
  listing: Listing;
  /** Board-wide realized rate (soldPrice ÷ asking) for the "likely net" hint; null if unknown. */
  realizedRate: number | null;
  nowMs: number;
  selected: boolean;
  onToggleSelect: (itemId: string) => void;
  onRemoved: (itemId: string) => void;
  onPatch: (itemId: string, next: Partial<Pick<Listing, "status" | "askingCents" | "soldPriceCents">>) => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [priceInput, setPriceInput] = useState(centsToInput(listing.askingCents));
  const [condition, setCondition] = useState<ItemCondition | "">(listing.condition ?? "");
  const [marketplaces, setMarketplaces] = useState<string[]>(listing.marketplaces);
  const [status, setStatus] = useState<SaleStatus>(listing.status as SaleStatus);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [markingSold, setMarkingSold] = useState(false);

  // Follow external status changes (bulk actions) without discarding edits.
  useEffect(() => {
    setStatus(listing.status as SaleStatus);
  }, [listing.status]);

  const stale = isStaleListing(listing, nowMs);
  const daysIdle = daysBetween(listing.updatedAtMs, nowMs);
  // Default the sale price to the recorded proceeds, else the current asking price.
  const [soldPriceInput, setSoldPriceInput] = useState(
    centsToInput(listing.soldPriceCents ?? listing.askingCents),
  );

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const nextAsking = dollarsToCents(priceInput);
      const res = await updateSaleListing({
        itemId: listing.itemId,
        title,
        description,
        askingCents: nextAsking,
        condition: condition || null,
        marketplaces,
      });
      setSaveState(res.ok ? "saved" : "error");
      if (res.ok) onPatch(listing.itemId, { askingCents: nextAsking });
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, priceInput, condition, marketplaces]);

  function regenerate() {
    const draft = buildListingDraft(listing.item, { condition: condition || null });
    setTitle(draft.title);
    setDescription(draft.description);
  }

  function applySuggestedPrice() {
    const suggested = suggestedAskingCents(listing.retailCents, condition || "good");
    if (suggested != null) setPriceInput(centsToInput(suggested));
  }

  function toggleMarketplace(id: string) {
    setMarketplaces((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function changeStatus(next: SaleStatus, soldPriceCents?: number | null) {
    setStatus(next);
    // Leaving "sold" clears the recorded proceeds; the server does the same.
    onPatch(listing.itemId, {
      status: next,
      ...(next === "sold" ? { soldPriceCents: soldPriceCents ?? null } : { soldPriceCents: null }),
    });
    await setSaleStatus({
      itemId: listing.itemId,
      status: next,
      ...(next === "sold" ? { soldPriceCents: soldPriceCents ?? null } : {}),
    });
  }

  async function confirmSold() {
    const cents = dollarsToCents(soldPriceInput);
    await changeStatus("sold", cents);
    setMarkingSold(false);
  }

  function clipboardText(): string {
    return listingClipboardText({
      title,
      description,
      askingCents: dollarsToCents(priceInput),
      currency: listing.currency,
      condition: condition || null,
      hashtags: buildListingDraft(listing.item, { condition: condition || null }).hashtags,
    });
  }

  async function copyDraft(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(clipboardText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      setCopied(false);
      return false;
    }
  }

  /** Copy the full listing, then open the marketplace's new-listing page ready to paste. */
  async function copyAndOpen(url: string) {
    await copyDraft();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /** Flush draft edits, then download listing.txt + photos as a zip. */
  async function exportBundle() {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    const nextAsking = dollarsToCents(priceInput);
    const save = await updateSaleListing({
      itemId: listing.itemId,
      title,
      description,
      askingCents: nextAsking,
      condition: condition || null,
      marketplaces,
    });
    if (!save.ok) {
      setExportNote("Save failed — try again");
      setExporting(false);
      return;
    }
    onPatch(listing.itemId, { askingCents: nextAsking });
    const res = await downloadExportBundle([listing.itemId]);
    setExportNote(res.ok ? "Downloaded" : res.error);
    if (res.ok) window.setTimeout(() => setExportNote(null), 2000);
    setExporting(false);
  }

  const selectedMarketplaces = MARKETPLACES.filter((m) => marketplaces.includes(m.id));

  return (
    <motion.li
      layout
      variants={listItem}
      initial="hidden"
      animate="show"
      exit="exit"
      className={`rounded-3xl border bg-white p-4 shadow-tile sm:p-5 ${
        selected ? "border-ink ring-1 ring-ink/30" : "border-ink/10"
      }`}
    >
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="flex gap-4 sm:block sm:w-40 sm:shrink-0">
          <div className="relative h-40 w-32 shrink-0 overflow-hidden rounded-2xl bg-paper-warm sm:h-48 sm:w-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(listing.imagePath)}
              alt={title}
              className="h-full w-full object-cover"
            />
            {status !== "sold" && (
              <label className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow-sm">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(listing.itemId)}
                  aria-label="Select listing"
                  className="accent-ink"
                />
              </label>
            )}
          </div>
          <div className="sm:mt-3">
            <StatusBadge status={status} />
            {stale && (
              <p className="mt-2 text-[11px] font-medium text-amber-700">
                Idle {daysIdle}d — needs attention
              </p>
            )}
            {listing.retailCents ? (
              <p className="mt-2 text-[11px] text-ink-muted">
                Paid {formatCents(listing.retailCents, listing.currency)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Price</label>
              <div className="mt-1 flex items-center rounded-xl border border-ink/15 bg-paper px-3 py-2">
                <span className="text-sm text-ink-muted">$</span>
                <input
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full bg-transparent pl-1 text-sm focus:outline-none"
                />
              </div>
            </div>
            <div className="min-w-[8rem] flex-1">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as ItemCondition | "")}
                className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
              >
                <option value="">—</option>
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {listing.retailCents ? (
              <button
                type="button"
                onClick={applySuggestedPrice}
                className="rounded-full border border-ink/15 px-3 py-2 text-xs transition hover:bg-paper-warm"
              >
                Suggest price
              </button>
            ) : null}
          </div>

          {(status === "for_sale" || status === "listed") &&
            realizedRate != null &&
            (() => {
              const asking = dollarsToCents(priceInput);
              if (!asking || asking <= 0) return null;
              return (
                <p className="-mt-2 text-[11px] text-ink-muted">
                  Your pieces sell at {formatRate(realizedRate)} of asking — likely{" "}
                  <span className="font-medium text-ink">
                    {formatCents(Math.round(asking * realizedRate), listing.currency)}
                  </span>{" "}
                  at this price.
                </p>
              );
            })()}

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Description
              </label>
              <button
                type="button"
                onClick={regenerate}
                className="text-[11px] text-ink-muted underline hover:text-ink"
              >
                Regenerate from item
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="mt-1 w-full resize-y rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm leading-relaxed focus:border-ink/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
              List on
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {MARKETPLACES.map((m) => {
                const on = marketplaces.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMarketplace(m.id)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      on
                        ? "border-ink bg-ink text-paper"
                        : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={copyDraft}
              className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft"
            >
              {copied ? "Copied!" : "Copy listing"}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={exportBundle}
              className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm disabled:opacity-50"
              title="Download listing.txt plus catalog photos as a zip"
            >
              {exporting ? "Exporting…" : exportNote === "Downloaded" ? "Downloaded!" : "Download bundle"}
            </button>
            {selectedMarketplaces.length > 0 ? (
              selectedMarketplaces.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => copyAndOpen(m.sellUrl)}
                  className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm"
                  title={m.note ? `${m.note} — copies the listing, then opens` : "Copies the listing, then opens"}
                >
                  Copy &amp; open {m.label} ↗
                </button>
              ))
            ) : (
              <span className="text-[11px] text-ink-muted">
                Pick a marketplace above for quick links.
              </span>
            )}
            <span className="ml-auto text-[11px] text-ink-muted">
              {exportNote && exportNote !== "Downloaded"
                ? exportNote
                : saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved"
                    : saveState === "error"
                      ? "Save failed"
                      : ""}
            </span>
          </div>

          {status === "sold" && listing.soldPriceCents != null && (
            <p className="text-xs text-ink-muted">
              Sold for{" "}
              <span className="font-medium text-ink">
                {formatCents(listing.soldPriceCents, listing.currency)}
              </span>
            </p>
          )}

          {markingSold && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-paper-warm p-3">
              <div className="w-28">
                <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                  Sold for
                </label>
                <div className="mt-1 flex items-center rounded-xl border border-ink/15 bg-paper px-3 py-2">
                  <span className="text-sm text-ink-muted">$</span>
                  <input
                    value={soldPriceInput}
                    onChange={(e) => setSoldPriceInput(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    autoFocus
                    className="w-full bg-transparent pl-1 text-sm focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={confirmSold}
                className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft"
              >
                Confirm sold
              </button>
              <button
                type="button"
                onClick={() => setMarkingSold(false)}
                className="rounded-full border border-ink/15 px-3 py-2 text-xs transition hover:bg-white"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
            {status !== "listed" && (
              <button
                type="button"
                onClick={() => changeStatus("listed")}
                className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper-warm"
              >
                Mark listed
              </button>
            )}
            {status !== "sold" && (
              <button
                type="button"
                onClick={() => {
                  setSoldPriceInput(centsToInput(listing.soldPriceCents ?? dollarsToCents(priceInput)));
                  setMarkingSold(true);
                }}
                className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper-warm"
              >
                Mark sold
              </button>
            )}
            {status !== "for_sale" && (
              <button
                type="button"
                onClick={() => changeStatus("for_sale")}
                className="rounded-full border border-ink/15 px-3 py-1.5 text-xs transition hover:bg-paper-warm"
              >
                Back to for sale
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                const res = await removeSaleListing(listing.itemId);
                if (res.ok) onRemoved(listing.itemId);
              }}
              className="ml-auto rounded-full px-3 py-1.5 text-xs text-rose-700 transition hover:bg-rose-50"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function StatusBadge({ status }: { status: SaleStatus }) {
  const styles: Record<SaleStatus, string> = {
    for_sale: "bg-emerald-100 text-emerald-900",
    listed: "bg-sky-100 text-sky-900",
    sold: "bg-ink/10 text-ink-muted",
    skipped: "bg-paper-warm text-ink-muted",
  };
  const labels: Record<SaleStatus, string> = {
    for_sale: "For sale",
    listed: "Listed",
    sold: "Sold",
    skipped: "Keeping",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wide ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
