"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/sale-listing";
import type { BudgetSummary } from "@/lib/wishlist/budget";
import { centsToInput } from "@/lib/wishlist/priority";
import { saveBudget } from "./actions";
import type { BudgetView } from "./wishlist-client";

/**
 * The headline number. Three bands across one bar: spent (solid), planned
 * (hatched — money promised but not gone yet), and what's genuinely free.
 */
export function BudgetMeter({
  budget,
  summary,
}: {
  budget: BudgetView | null;
  summary: BudgetSummary;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(budget == null);
  const [name, setName] = useState(budget?.name ?? "Grandma fund");
  const [amount, setAmount] = useState(centsToInput(budget?.amountCents));
  const [fundedBySales, setFundedBySales] = useState(budget?.fundedBySales ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = budget?.currency ?? "USD";
  const money = (cents: number) => formatCents(cents, currency);

  async function submit() {
    const dollars = Number(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter a budget amount.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveBudget({ name, amountDollars: dollars, fundedBySales });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
        <h2 className="font-serif text-2xl">
          {budget ? "Edit your budget" : "Set your budget"}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          How much have you got to spend? Everything on the list gets measured against it.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="budget-name"
              className="block text-[11px] uppercase tracking-wide text-ink-muted"
            >
              What&apos;s this money for?
            </label>
            <input
              id="budget-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grandma fund"
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="budget-amount"
              className="block text-[11px] uppercase tracking-wide text-ink-muted"
            >
              Amount
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                $
              </span>
              <input
                id="budget-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="10,000"
                className="w-full rounded-xl border border-ink/15 bg-paper py-2 pl-7 pr-3 text-sm focus:border-ink/40 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={fundedBySales}
            onChange={(e) => setFundedBySales(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Top this up with resale proceeds
            <span className="block text-xs text-ink-muted">
              Anything you mark sold in Sell gets added to the pot.
            </span>
          </span>
        </label>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save budget"}
          </button>
          {budget ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const { fundsCents, spentCents, plannedCents, uncommittedCents } = summary;
  const pct = (cents: number) =>
    fundsCents > 0 ? `${Math.min(100, Math.max(0, (cents / fundsCents) * 100))}%` : "0%";

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">{budget?.name}</h2>
          <p className="mt-0.5 text-xs uppercase tracking-[0.18em] text-ink-muted">
            {money(fundsCents)} to spend
            {summary.salesCents > 0 ? ` · includes ${money(summary.salesCents)} from sales` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-ink-muted underline hover:text-ink"
        >
          Edit
        </button>
      </div>

      <div className="mt-5">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-ink/10"
          role="img"
          aria-label={`${money(spentCents)} spent, ${money(plannedCents)} planned, of ${money(fundsCents)}`}
        >
          <div className="h-full bg-ink transition-[width]" style={{ width: pct(spentCents) }} />
          <div
            className="h-full bg-accent/60 transition-[width]"
            style={{
              width: pct(plannedCents),
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px)",
            }}
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          <Stat label="Spent" value={money(spentCents)} hint={`${summary.purchasedCount} bought`} />
          <Stat
            label="Planned"
            value={money(plannedCents)}
            hint={`${summary.plannedCount} on the list`}
          />
          <Stat label="Left to spend" value={money(summary.remainingCents)} emphasis />
          <Stat
            label={uncommittedCents < 0 ? "Over the list" : "Still unspoken for"}
            value={money(Math.abs(uncommittedCents))}
            tone={uncommittedCents < 0 ? "warn" : "default"}
          />
        </dl>
      </div>

      {summary.overCommitted ? (
        <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your list costs {money(Math.abs(uncommittedCents))} more than you have left. Drop
          something to <em>Someday</em>, or wait for a price to fall.
        </p>
      ) : null}

      {summary.unpricedCount > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          {summary.unpricedCount} {summary.unpricedCount === 1 ? "item has" : "items have"} no
          price yet, so &ldquo;planned&rdquo; is an undercount.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  tone?: "default" | "warn";
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={`mt-0.5 tabular-nums ${emphasis ? "font-serif text-2xl" : "text-lg"} ${
          tone === "warn" ? "text-amber-800" : "text-ink"
        }`}
      >
        {value}
      </dd>
      {hint ? <p className="text-[11px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}
