"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { thumbnailUrl } from "@/lib/image-paths";
import { formatCents } from "@/lib/sale-listing";
import type { BudgetSummary } from "@/lib/wishlist/budget";
import { rankByAffordability } from "@/lib/wishlist/budget";
import type { GapReport, ItemVerdict } from "@/lib/wishlist/gaps";
import type { PriceDrop } from "@/lib/wishlist/price-watch";
import { PRIORITY_OPTIONS, centsToInput, normalizePriority } from "@/lib/wishlist/priority";
import { AddPanel } from "./add-panel";
import { BudgetMeter } from "./budget-meter";
import {
  markPurchased,
  refreshPrices,
  removeWishlistItem,
  setCategory,
  setPrice,
  setPriority,
  unmarkPurchased,
} from "./actions";

export type BudgetView = {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
  fundedBySales: boolean;
};

export type WishlistRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  imagePath: string;
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string | null;
  /** Named to match BudgetLineItem so the budget math accepts a row directly. */
  wishlistPriority: number;
  purchasedAt: string | null;
  purchasedCents: number | null;
  priceCheckedAt: string | null;
  priceDrop: PriceDrop | null;
  verdict: ItemVerdict;
};

export function WishlistClient({
  budget,
  summary,
  rows,
  purchased,
  gaps,
  categories,
}: {
  budget: BudgetView | null;
  summary: BudgetSummary;
  rows: WishlistRow[];
  purchased: WishlistRow[];
  gaps: GapReport;
  categories: string[];
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  // Buy order plus the point at which the money runs out. Only meaningful
  // once a budget exists — otherwise everything reads as unaffordable.
  const ranked = useMemo(
    () => rankByAffordability(rows, budget ? summary.remainingCents : Number.MAX_SAFE_INTEGER),
    [rows, summary.remainingCents, budget],
  );

  const cutoffIndex = budget ? ranked.findIndex((r) => !r.affordable) : -1;
  const drops = rows.filter((r) => r.priceDrop != null);

  async function runPriceCheck() {
    setChecking(true);
    setCheckNote(null);
    const res = await refreshPrices();
    setChecking(false);
    if (!res.ok) {
      setCheckNote(res.error);
      return;
    }
    const { checked, changed, skipped } = res.value;
    setCheckNote(
      checked === 0
        ? "Nothing to check — none of your items have a store link yet."
        : `Checked ${checked}. ${changed} price${changed === 1 ? "" : "s"} moved.` +
            (skipped > 0 ? ` ${skipped} couldn't be read.` : ""),
    );
    router.refresh();
  }

  return (
    <div className="space-y-12">
      <BudgetMeter budget={budget} summary={summary} />
      <AddPanel />

      {drops.length > 0 ? <PriceDropBanner rows={drops} /> : null}

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">
            On the list{rows.length > 0 ? ` (${rows.length})` : ""}
          </h2>
          <div className="flex items-center gap-3 text-xs">
            {checkNote ? <span className="text-ink-muted">{checkNote}</span> : null}
            <button
              type="button"
              onClick={runPriceCheck}
              disabled={checking || rows.length === 0}
              className="rounded-full bg-paper-warm px-3 py-1 tracking-wide text-ink transition hover:bg-ink/5 disabled:opacity-50"
            >
              {checking ? "Checking prices…" : "Check prices"}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyWishlist />
        ) : (
          <ul className="space-y-3">
            {ranked.map((row, index) => (
              <li key={row.item.id}>
                {index === cutoffIndex ? (
                  <BudgetLine remainingCents={summary.remainingCents} currency={budget?.currency} />
                ) : null}
                <WishlistCard
                  row={row.item}
                  cumulativeCents={row.cumulativeCents}
                  affordable={!budget || row.affordable}
                  categories={categories}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {gaps.coverage.length > 0 ? <GapPanel gaps={gaps} /> : null}

      {purchased.length > 0 ? (
        <section>
          <h2 className="mb-4 font-serif text-2xl">Bought ({purchased.length})</h2>
          <ul className="space-y-3">
            {purchased.map((row) => (
              <li key={row.id}>
                <PurchasedCard row={row} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function WishlistCard({
  row,
  cumulativeCents,
  affordable,
  categories,
}: {
  row: WishlistRow;
  cumulativeCents: number;
  affordable: boolean;
  categories: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState(centsToInput(row.priceCents));
  const [buying, setBuying] = useState(false);
  const [paidDraft, setPaidDraft] = useState(centsToInput(row.priceCents));

  const money = (cents: number | null) => (cents == null ? "—" : formatCents(cents, row.currency));

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
  }

  return (
    <article
      className={`flex flex-wrap gap-4 rounded-2xl border p-4 transition sm:flex-nowrap ${
        affordable ? "border-ink/10 bg-white shadow-tile" : "border-ink/10 bg-paper-warm opacity-75"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl(row.imagePath)}
        alt={row.name}
        loading="lazy"
        className="h-28 w-28 shrink-0 rounded-xl bg-white object-cover"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-medium">{row.name}</h3>
            <p className="truncate text-sm text-ink-muted">{row.brand ?? "—"}</p>
          </div>
          <div className="text-right">
            {editingPrice ? (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                    $
                  </span>
                  <input
                    value={priceDraft}
                    onChange={(e) => setPriceDraft(e.target.value)}
                    inputMode="decimal"
                    autoFocus
                    className="w-24 rounded-lg border border-ink/15 bg-paper py-1 pl-6 pr-2 text-sm focus:border-ink/40 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const n = Number(priceDraft.replace(/[^0-9.]/g, ""));
                    await run("price", () =>
                      setPrice(row.id, Number.isFinite(n) && n > 0 ? n : null),
                    );
                    setEditingPrice(false);
                  }}
                  className="text-xs underline text-ink-muted hover:text-ink"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingPrice(true)}
                className="font-serif text-2xl tabular-nums hover:underline"
                title="Edit price"
              >
                {money(row.priceCents)}
              </button>
            )}
            {row.priceDrop ? (
              <p className="text-xs text-green-700">
                down {formatCents(row.priceDrop.dropCents, row.currency)} (
                {row.priceDrop.dropPercent}%)
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={categories.includes(row.category) ? row.category : ""}
            onChange={(e) => run("category", () => setCategory(row.id, e.target.value))}
            disabled={busy != null}
            aria-label={`Category for ${row.name}`}
            className="rounded-full bg-paper-warm px-2.5 py-1 text-[11px] tracking-wide text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => run(`p${opt.value}`, () => setPriority(row.id, opt.value))}
              disabled={busy != null}
              title={opt.hint}
              className={`rounded-full px-2.5 py-0.5 text-[11px] tracking-wide transition disabled:opacity-50 ${
                normalizePriority(row.wishlistPriority) === opt.value
                  ? "bg-ink text-paper"
                  : "bg-paper-warm text-ink-muted hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <VerdictChip verdict={row.verdict} category={row.category} categories={categories} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
          {row.productUrl ? (
            <a
              href={row.productUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline text-ink-muted hover:text-ink"
            >
              {row.retailer ? `Buy at ${row.retailer}` : "Open store page"} ↗
            </a>
          ) : (
            <span className="text-ink-muted">No store link</span>
          )}

          <span className="tabular-nums text-ink-muted">
            running total {formatCents(cumulativeCents, row.currency)}
          </span>

          {buying ? (
            <span className="flex items-center gap-2">
              <span className="text-ink-muted">Paid</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted">
                  $
                </span>
                <input
                  value={paidDraft}
                  onChange={(e) => setPaidDraft(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="w-24 rounded-lg border border-ink/15 bg-paper py-1 pl-5 pr-2 focus:border-ink/40 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  const n = Number(paidDraft.replace(/[^0-9.]/g, ""));
                  await run("buy", () =>
                    markPurchased(row.id, Number.isFinite(n) && n > 0 ? n : null),
                  );
                }}
                className="underline hover:text-ink"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setBuying(false)}
                className="text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setBuying(true)}
              className="underline text-ink-muted hover:text-ink"
            >
              I bought this
            </button>
          )}

          <button
            type="button"
            onClick={() => run("remove", () => removeWishlistItem(row.id))}
            disabled={busy != null}
            className="ml-auto text-ink-muted hover:text-red-700 disabled:opacity-50"
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </article>
  );
}

function PurchasedCard({ row }: { row: WishlistRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const paid = row.purchasedCents ?? row.priceCents;

  return (
    <article className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-paper-warm p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl(row.imagePath)}
        alt={row.name}
        loading="lazy"
        className="h-16 w-16 shrink-0 rounded-lg bg-white object-cover"
      />
      <div className="min-w-0 flex-1">
        <Link href={`/closet/${row.id}`} className="truncate font-medium hover:underline">
          {row.name}
        </Link>
        <p className="truncate text-xs text-ink-muted">
          {[row.brand, row.purchasedAt ? formatDate(row.purchasedAt) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="text-right">
        <p className="tabular-nums">{paid == null ? "—" : formatCents(paid, row.currency)}</p>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            const res = await unmarkPurchased(row.id);
            setBusy(false);
            if (res.ok) router.refresh();
          }}
          disabled={busy}
          className="text-[11px] text-ink-muted underline hover:text-ink disabled:opacity-50"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- fragments */

function BudgetLine({
  remainingCents,
  currency,
}: {
  remainingCents: number;
  currency?: string;
}) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-3" role="separator">
      <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.18em] text-amber-800">
        {formatCents(Math.max(0, remainingCents), currency ?? "USD")} runs out here
      </span>
      <span className="h-px flex-1 bg-amber-800/30" />
    </div>
  );
}

function VerdictChip({
  verdict,
  category,
  categories,
}: {
  verdict: ItemVerdict;
  category: string;
  categories: string[];
}) {
  // An uncategorised item can't be judged against the closet.
  if (!category || !categories.length) return null;
  if (verdict === "neutral") return null;

  const isGap = verdict === "fills-gap";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] tracking-wide ${
        isGap ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"
      }`}
      title={
        isGap
          ? `You own little or nothing in ${category}.`
          : `You already own plenty in ${category}.`
      }
    >
      {isGap ? "Fills a gap" : "You have plenty"}
    </span>
  );
}

function PriceDropBanner({ rows }: { rows: WishlistRow[] }) {
  const total = rows.reduce((sum, r) => sum + (r.priceDrop?.dropCents ?? 0), 0);
  return (
    <section className="rounded-2xl border border-green-700/20 bg-green-50 p-5">
      <h2 className="font-serif text-xl text-green-900">
        {rows.length} {rows.length === 1 ? "price has" : "prices have"} dropped
      </h2>
      <p className="mt-1 text-sm text-green-900/80">
        {formatCents(total, rows[0]?.currency ?? "USD")} cheaper than the highest price we&apos;ve
        seen.
      </p>
      <ul className="mt-3 space-y-1 text-sm text-green-900">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{r.name}</span>
            <span className="tabular-nums line-through opacity-60">
              {formatCents(r.priceDrop!.fromCents, r.currency)}
            </span>
            <span className="tabular-nums">{formatCents(r.priceDrop!.toCents, r.currency)}</span>
            <span className="text-xs opacity-70">−{r.priceDrop!.dropPercent}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GapPanel({ gaps }: { gaps: GapReport }) {
  const empty = gaps.gaps.filter((c) => c.owned === 0);
  const thin = gaps.gaps.filter((c) => c.owned > 0);

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
      <h2 className="font-serif text-2xl">Where the money should go</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Measured against what you already own — not what&apos;s trending.
      </p>

      <div className="mt-5 grid gap-6 sm:grid-cols-3">
        <GapColumn
          title="Nothing here"
          tone="gap"
          rows={empty}
          empty="No empty categories — nice."
        />
        <GapColumn title="Running thin" tone="thin" rows={thin} empty="Nothing looks thin." />
        <GapColumn
          title="You have plenty"
          tone="saturated"
          rows={gaps.saturated}
          empty="Nothing's overstocked."
        />
      </div>
    </section>
  );
}

function GapColumn({
  title,
  tone,
  rows,
  empty,
}: {
  title: string;
  tone: "gap" | "thin" | "saturated";
  rows: GapReport["coverage"];
  empty: string;
}) {
  const dot =
    tone === "gap" ? "bg-red-500" : tone === "thin" ? "bg-amber-500" : "bg-ink/30";

  return (
    <div>
      <h3 className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((c) => (
            <li key={c.category} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{c.category}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {c.owned}
                {c.wishlisted > 0 ? ` (+${c.wishlisted})` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyWishlist() {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center">
      <p className="font-serif text-2xl">Nothing on the list yet.</p>
      <p className="mt-2 text-ink-muted">
        Paste a link to something you&apos;ve had your eye on.
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
