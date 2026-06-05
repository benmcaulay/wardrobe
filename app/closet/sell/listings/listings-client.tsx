"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { imageUrl } from "@/lib/image-paths";
import { MARKETPLACES } from "@/lib/marketplaces";
import {
  CONDITION_OPTIONS,
  buildListingDraft,
  formatCents,
  suggestedAskingCents,
  type ItemCondition,
  type ListingItemInput,
  type SaleStatus,
} from "@/lib/sale-listing";
import { removeSaleListing, setSaleStatus, updateSaleListing } from "../actions";

export type Listing = {
  itemId: string;
  status: string;
  askingCents: number | null;
  currency: string;
  condition: ItemCondition | null;
  title: string;
  description: string;
  marketplaces: string[];
  retailCents: number | null;
  categoryLabel: string;
  imagePath: string;
  item: ListingItemInput;
};

const STATUS_ORDER: SaleStatus[] = ["for_sale", "listed", "sold"];

export function ListingsClient({ initial }: { initial: Listing[] }) {
  const [listings, setListings] = useState<Listing[]>(initial);

  if (listings.length === 0) {
    return (
      <div className="rounded-3xl border border-ink/10 bg-paper-warm p-12 text-center">
        <p className="font-serif text-2xl">Nothing listed yet.</p>
        <p className="mt-2 text-ink-muted">Swipe right on pieces you want to sell.</p>
        <Link
          href="/closet/sell"
          className="mt-6 inline-block rounded-full bg-ink px-6 py-2.5 text-sm tracking-wide text-paper transition hover:bg-ink-soft"
        >
          Start swiping
        </Link>
      </div>
    );
  }

  const ordered = [...listings].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status as SaleStatus) - STATUS_ORDER.indexOf(b.status as SaleStatus),
  );

  return (
    <ul className="space-y-5">
      {ordered.map((listing) => (
        <ListingCard
          key={listing.itemId}
          listing={listing}
          onRemoved={(id) => setListings((prev) => prev.filter((l) => l.itemId !== id))}
        />
      ))}
    </ul>
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
  onRemoved,
}: {
  listing: Listing;
  onRemoved: (itemId: string) => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [priceInput, setPriceInput] = useState(centsToInput(listing.askingCents));
  const [condition, setCondition] = useState<ItemCondition | "">(listing.condition ?? "");
  const [marketplaces, setMarketplaces] = useState<string[]>(listing.marketplaces);
  const [status, setStatus] = useState<SaleStatus>(listing.status as SaleStatus);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState(false);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const res = await updateSaleListing({
        itemId: listing.itemId,
        title,
        description,
        askingCents: dollarsToCents(priceInput),
        condition: condition || null,
        marketplaces,
      });
      setSaveState(res.ok ? "saved" : "error");
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

  async function changeStatus(next: SaleStatus) {
    setStatus(next);
    await setSaleStatus({ itemId: listing.itemId, status: next });
  }

  async function copyDraft() {
    const price = dollarsToCents(priceInput);
    const text = [title, price != null ? `Price: ${formatCents(price, listing.currency)}` : null, "", description]
      .filter((l) => l !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const selectedMarketplaces = MARKETPLACES.filter((m) => marketplaces.includes(m.id));

  return (
    <li className="rounded-3xl border border-ink/10 bg-white p-4 shadow-tile sm:p-5">
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="flex gap-4 sm:block sm:w-40 sm:shrink-0">
          <div className="h-40 w-32 shrink-0 overflow-hidden rounded-2xl bg-paper-warm sm:h-48 sm:w-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(listing.imagePath)}
              alt={title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="sm:mt-3">
            <StatusBadge status={status} />
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
            {selectedMarketplaces.length > 0 ? (
              selectedMarketplaces.map((m) => (
                <a
                  key={m.id}
                  href={m.sellUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm"
                  title={m.note}
                >
                  Open {m.label} ↗
                </a>
              ))
            ) : (
              <span className="text-[11px] text-ink-muted">
                Pick a marketplace above for quick links.
              </span>
            )}
            <span className="ml-auto text-[11px] text-ink-muted">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "error"
                    ? "Save failed"
                    : ""}
            </span>
          </div>

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
                onClick={() => changeStatus("sold")}
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
    </li>
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
