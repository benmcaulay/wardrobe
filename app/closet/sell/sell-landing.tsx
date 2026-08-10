"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { MarketplaceMark, marketplaceColor } from "@/components/marketplace-mark";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { formatCents, STALE_AFTER_DAYS } from "@/lib/sale-listing";
import { formatDays, type EarningsSummary, type Opportunity, type PlatformStats } from "@/lib/sell/metrics";
import { fadeUp, staggerContainer } from "@/lib/ui-motion";
import { LogSaleSheet, type SellableItem } from "./log-sale-sheet";
import { LensesClient } from "./lenses-client";
import type { ClosetLenses } from "@/lib/actions/closet-lenses";

type Props = {
  earnings: EarningsSummary;
  thisMonth: { grossCents: number; netCents: number; soldCount: number };
  opportunity: Opportunity;
  platforms: PlatformStats[];
  timing: { avgDays: number | null; timedSaleCount: number };
  counts: { forSale: number; listed: number; sold: number; untriaged: number };
  staleCount: number;
  currency: string;
  sellable: SellableItem[];
  lenses: ClosetLenses;
};

export function SellLanding(props: Props) {
  const {
    earnings,
    thisMonth,
    opportunity,
    platforms,
    timing,
    counts,
    staleCount,
    currency,
    sellable,
    lenses,
  } = props;
  const reduce = useReducedMotion();
  const [logOpen, setLogOpen] = useState(false);

  const hasSold = earnings.soldCount > 0;
  const hasAnything = hasSold || opportunity.totalCount > 0;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      {/* pr-28 clears the fixed menu trigger (app/closet/layout.tsx). */}
      <nav className="text-xs text-ink-muted mb-8 flex items-center justify-between pr-28">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
        {(counts.forSale + counts.listed + counts.sold > 0) && (
          <Link href="/closet/sell/listings" className="hover:text-ink">
            Your listings ({counts.forSale + counts.listed + counts.sold}) →
          </Link>
        )}
      </nav>

      <motion.div variants={staggerContainer} initial={reduce ? false : "hidden"} animate="show">
        {/* ── Hero: what you've made, and what's still to come ─────────────── */}
        <motion.header variants={fadeUp} className="flex flex-wrap items-end gap-x-10 gap-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">You&apos;ve made</p>
            <p className="font-serif text-5xl tracking-tight leading-none mt-1">
              {formatCents(earnings.grossCents, currency) || "$0"}
            </p>
            <p className="text-xs text-ink-muted mt-1.5">
              {hasSold ? (
                <>
                  gross
                  {earnings.feesCents + earnings.shippingCents > 0 && (
                    <> · {formatCents(earnings.netCents, currency)} after fees</>
                  )}
                  {thisMonth.grossCents > 0 && (
                    <> · {formatCents(thisMonth.grossCents, currency)} this month</>
                  )}
                </>
              ) : (
                "no sales logged yet"
              )}
            </p>
          </div>

          <div aria-hidden className="hidden sm:block w-px self-stretch bg-ink/15 mb-2" />

          <div>
            <p className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
              Still on the table
            </p>
            <p className="font-serif text-5xl tracking-tight leading-none mt-1 text-ink-soft">
              {formatCents(opportunity.totalCents, currency) || "$0"}
            </p>
            <p className="text-xs text-ink-muted mt-1.5">
              {opportunity.totalCount > 0 ? (
                <>
                  {opportunity.totalCount} {opportunity.totalCount === 1 ? "piece" : "pieces"} unsold
                  or unsorted
                  {opportunity.unpricedCount > 0 && (
                    <> · {opportunity.unpricedCount} with no price to estimate from</>
                  )}
                </>
              ) : (
                "nothing waiting"
              )}
            </p>
          </div>
        </motion.header>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <motion.div variants={fadeUp} className="mt-7 flex flex-wrap items-center gap-2.5">
          <Link
            href="/closet/sell/triage"
            className="rounded-full bg-ink px-6 py-3 text-sm tracking-wide text-paper transition hover:bg-ink-soft"
          >
            Sell or keep
            {counts.untriaged > 0 && (
              <span className="opacity-60"> · {counts.untriaged} to sort</span>
            )}
          </Link>
          {counts.forSale + counts.listed + counts.sold > 0 && (
            <Link
              href="/closet/sell/listings"
              className="rounded-full border border-ink/25 px-5 py-3 text-sm transition hover:bg-paper-warm"
            >
              Your listings · {counts.forSale + counts.listed + counts.sold}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="px-2 py-3 text-sm text-ink-muted underline-offset-4 transition hover:text-ink hover:underline"
          >
            Log a sale
          </button>
        </motion.div>

        {!hasAnything && (
          <motion.p
            variants={fadeUp}
            className="mt-8 rounded-3xl border border-ink/10 bg-paper-warm px-6 py-8 text-center text-ink-muted"
          >
            Add pieces to your closet, then sort them into keep or sell. What you decide to sell
            shows up here with what it&apos;s worth.
          </motion.p>
        )}

        {/* ── Counts ───────────────────────────────────────────────────────── */}
        {hasAnything && (
          <motion.dl variants={fadeUp} className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile label="For sale" value={counts.forSale} />
            <Tile label="Listed" value={counts.listed} />
            <Tile label="Sold" value={counts.sold} />
            <Tile
              label="Avg to sell"
              value={timing.avgDays == null ? "—" : formatDays(timing.avgDays)}
              hint={
                timing.avgDays != null
                  ? `across ${timing.timedSaleCount} ${timing.timedSaleCount === 1 ? "sale" : "sales"}`
                  : counts.sold > 0
                    ? // Sales exist but none has a listed date to measure from.
                      "mark listings live to track"
                    : "once you log a sale"
              }
            />
          </motion.dl>
        )}

        {/* ── Where your pieces sell ───────────────────────────────────────── */}
        {(platforms.length > 0 || counts.forSale + counts.listed > 0) && (
          <motion.section variants={fadeUp} className="mt-9">
            <h2 className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
              Where your pieces sell
            </h2>
            <div className="mt-1.5 border-b border-ink/10">
              {MARKETPLACES.map((m) => {
                const stats = platforms.find((p) => p.platform === m.id);
                return <PlatformRow key={m.id} platform={m.id} stats={stats} currency={currency} topGross={platforms[0]?.grossCents ?? 0} />;
              })}
            </div>
            {earnings.unattributedCount > 0 && (
              <p className="mt-2.5 text-xs text-ink-muted">
                {formatCents(earnings.unattributedGrossCents, currency)} from{" "}
                {earnings.unattributedCount}{" "}
                {earnings.unattributedCount === 1 ? "sale" : "sales"} with no platform recorded, so
                it isn&apos;t in the rows above.{" "}
                <button
                  type="button"
                  onClick={() => setLogOpen(true)}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  Add where they sold
                </button>
              </p>
            )}
          </motion.section>
        )}

        {staleCount > 0 && (
          <motion.p
            variants={fadeUp}
            className="mt-6 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {staleCount} {staleCount === 1 ? "listing hasn't" : "listings haven't"} moved in{" "}
            {STALE_AFTER_DAYS}+ days.{" "}
            <Link href="/closet/sell/listings" className="underline underline-offset-2">
              Drop the price or cross-post them
            </Link>
            .
          </motion.p>
        )}
      </motion.div>

      {/* ── Closet health ────────────────────────────────────────────────────
          Below a hard rule, with its own standfirst, because the page above it
          is about money and this is not. These are observations — quietest
          pieces, near-duplicates, what has held its value — and on a page
          titled Sell it would be very easy to read them as a list of things to
          get rid of. The divider and the "yours to decide" line are the whole
          mitigation; see lenses-client.tsx for why none of it may grow a CTA. */}
      <section className="mt-14 border-t border-ink/10 pt-8">
        <h2 className="font-serif text-2xl tracking-tight">Your closet, looked at</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Observations only. What to do about any of it is yours to decide.
        </p>
        <div className="mt-5">
          <LensesClient lenses={lenses} />
        </div>
      </section>

      <LogSaleSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        items={sellable}
        currency={currency}
      />
    </main>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-paper-warm px-3.5 py-3">
      <dd className="text-xl font-medium tabular-nums">{value}</dd>
      <dt className="text-[11px] text-ink-muted mt-0.5">{label}</dt>
      {hint && <p className="text-[10px] text-ink-muted/80 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * One marketplace. Untouched platforms still get a row — greyed out, as an
 * invitation to cross-post rather than a gap in the list. The bar is relative
 * to the best-performing platform, so it reads as "how this compares" rather
 * than implying an absolute target.
 */
function PlatformRow({
  platform,
  stats,
  currency,
  topGross,
}: {
  platform: MarketplaceId;
  stats: PlatformStats | undefined;
  currency: string;
  topGross: number;
}) {
  const used = !!stats && (stats.soldCount > 0 || stats.activeCount > 0);
  const share = topGross > 0 && stats ? Math.min(1, stats.grossCents / topGross) : 0;

  return (
    <div
      className="group flex items-center gap-3 border-t border-ink/10 px-3.5 py-2.5 transition-colors hover:bg-paper-warm"
      style={{ "--brand": marketplaceColor(platform) } as React.CSSProperties}
    >
      <span
        className={`flex-none w-[124px] whitespace-nowrap transition-colors ${
          used ? "text-ink group-hover:text-[color:var(--brand)]" : "text-ink-muted/50"
        }`}
      >
        <MarketplaceMark platform={platform} />
      </span>

      <span className="flex-1 min-w-0">
        <span className="block h-[5px] rounded-full bg-ink/10 overflow-hidden">
          {share > 0 && (
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          )}
        </span>
      </span>

      {used ? (
        <>
          <span className="flex-none w-16 text-right text-sm tabular-nums">
            {stats!.grossCents > 0 ? formatCents(stats!.grossCents, currency) : "—"}
          </span>
          <span className="flex-none w-24 text-right text-xs text-ink-muted">
            {stats!.soldCount > 0
              ? `${stats!.soldCount} sold${
                  stats!.avgDaysToSell != null ? ` · ${formatDays(stats!.avgDaysToSell)}` : ""
                }`
              : `${stats!.activeCount} live`}
          </span>
        </>
      ) : (
        <span className="flex-none w-40 text-right text-xs text-ink-muted/70">
          Not listed here yet
        </span>
      )}
    </div>
  );
}
