"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MarketplaceMark } from "@/components/marketplace-mark";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { formatCents } from "@/lib/sale-listing";
import { estimateFeeCents } from "@/lib/sell/fees";
import { completePayoutParse, parsePayoutEmail } from "@/lib/sell/payout-parse";
import { easeOutExpo } from "@/lib/ui-motion";
import { logSale } from "./actions";

export type SellableItem = {
  itemId: string;
  label: string;
  askingCents: number | null;
};

/** Dollars string → cents, or null for blank/garbage. */
function toCents(value: string): number | null {
  const trimmed = value.replace(/[^0-9.]/g, "").trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Cents → the plain "12.34" a number input wants. */
function toInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/**
 * Log a completed sale, parse-assisted.
 *
 * The paste box is the fast path: drop in a payout email and the fields below
 * fill themselves. It is only ever a *prefill* — every value stays editable and
 * nothing is written until the user submits, because the parser is matching
 * templates that change without notice (see lib/sell/payout-parse.ts).
 */
export function LogSaleSheet({
  open,
  onClose,
  items = [],
  currency = "USD",
}: {
  open: boolean;
  onClose: () => void;
  items?: SellableItem[];
  currency?: string;
}) {
  const reduce = useReducedMotion();
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  const [paste, setPaste] = useState("");
  const [itemId, setItemId] = useState("");
  const [platform, setPlatform] = useState<MarketplaceId | "">("");
  const [price, setPrice] = useState("");
  const [shipping, setShipping] = useState("");
  const [fee, setFee] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = useMemo(
    () => (paste.trim() ? completePayoutParse(parsePayoutEmail(paste)) : null),
    [paste],
  );

  // Let a parse fill the blanks, never overwrite something already typed.
  useEffect(() => {
    if (!parse) return;
    if (parse.platform) setPlatform((p) => p || parse.platform!);
    if (parse.grossCents != null) setPrice((p) => p || toInput(parse.grossCents));
    if (parse.shippingCents != null) setShipping((s) => s || toInput(parse.shippingCents));
    if (parse.feeCents != null) {
      setFee((f) => f || toInput(parse.feeCents));
      setFeeTouched(true);
    }
    if (parse.itemHint && !itemId) {
      const hint = parse.itemHint.toLowerCase();
      const match = items.find((i) => i.label.toLowerCase().includes(hint) || hint.includes(i.label.toLowerCase()));
      if (match) setItemId(match.itemId);
    }
  }, [parse, items, itemId]);

  const priceCents = toCents(price);
  const shippingCents = toCents(shipping);

  // Until the user edits it, the fee shows what the platform's rate implies.
  const estimatedFee =
    platform && priceCents != null ? estimateFeeCents(platform, priceCents) : null;
  const effectiveFee = feeTouched ? toCents(fee) : estimatedFee;
  const net =
    priceCents == null ? null : priceCents - (effectiveFee ?? 0) - (shippingCents ?? 0);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  function reset() {
    setPaste("");
    setItemId("");
    setPlatform("");
    setPrice("");
    setShipping("");
    setFee("");
    setFeeTouched(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (!itemId) return setError("Pick which piece sold.");
    if (!platform) return setError("Pick where it sold.");
    if (priceCents == null || priceCents <= 0) return setError("Enter what it sold for.");

    startTransition(async () => {
      const res = await logSale({
        itemId,
        platform,
        soldPriceCents: priceCents,
        // Only send a fee the user actually set; otherwise the server applies
        // the same rate and flags the row as estimated.
        feeCents: feeTouched ? toCents(fee) : null,
        shippingCents,
        soldAtMs: parse?.soldAtMs ?? null,
      });
      if (res.ok) {
        reset();
        onClose();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-ink/25"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Log a sale"
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-paper p-6 shadow-tile outline-none"
            initial={reduce ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-2xl tracking-tight">Log a sale</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-ink-muted hover:text-ink"
              >
                Close
              </button>
            </div>

            {/* ── Paste path ────────────────────────────────────────────────── */}
            <label className="mt-5 block">
              <span className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                Paste the payout email
              </span>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={3}
                placeholder="Paste it here and we'll fill in what we can — optional."
                className="mt-1.5 w-full resize-y rounded-2xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm placeholder:text-ink-muted/60 focus:border-ink/30"
              />
            </label>

            {parse && (
              <div className="mt-2 text-xs">
                {parse.found.length > 0 ? (
                  <p className="text-ink-muted">
                    Read {parse.found.filter((f) => f !== "item").join(", ")}
                    {parse.derived.length > 0 && `; worked out ${parse.derived.join(", ")}`}.
                    {parse.confidence < 0.5 && " Low confidence — check every field."}
                  </p>
                ) : (
                  <p className="text-ink-muted">
                    Couldn&apos;t read that one. Fill it in below.
                  </p>
                )}
                {parse.reconciliationWarning && (
                  <p className="mt-1.5 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900">
                    {parse.reconciliationWarning}
                  </p>
                )}
              </div>
            )}

            <div className="my-5 border-t border-ink/10" />

            {/* ── Manual fields ─────────────────────────────────────────────── */}
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                Which piece
              </span>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="">Pick a piece…</option>
                {items.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.label}
                    {i.askingCents != null ? ` — asking ${formatCents(i.askingCents, currency)}` : ""}
                  </option>
                ))}
              </select>
              {items.length === 0 && (
                <span className="mt-1 block text-xs text-ink-muted">
                  Nothing marked for sale yet — sort your closet first.
                </span>
              )}
            </label>

            <fieldset className="mt-4">
              <legend className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                Where it sold
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MARKETPLACES.map((m) => {
                  const active = platform === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPlatform(active ? "" : m.id)}
                      aria-pressed={active}
                      className={`flex items-center rounded-full border px-3 py-2 transition ${
                        active
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
                      }`}
                    >
                      <MarketplaceMark platform={m.id} height={12} />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <Money label="Sold for" value={price} onChange={setPrice} autoFocus={false} />
              <Money label="Shipping" value={shipping} onChange={setShipping} />
              <Money
                label="Fee"
                value={feeTouched ? fee : toInput(estimatedFee)}
                onChange={(v) => {
                  setFeeTouched(true);
                  setFee(v);
                }}
                hint={!feeTouched && estimatedFee != null ? "estimated" : undefined}
              />
            </div>

            {net != null && (
              <p className="mt-3 text-sm text-ink-muted">
                You keep <span className="font-medium text-ink">{formatCents(net, currency)}</span>
                {!feeTouched && estimatedFee != null && " (fee estimated from the platform's rate)"}
              </p>
            )}

            {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

            <div className="mt-5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition hover:bg-ink-soft disabled:opacity-50"
              >
                {pending ? "Saving…" : "Log the sale"}
              </button>
              <button
                type="button"
                onClick={reset}
                className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Clear
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Money({
  label,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">{label}</span>
      <span className="mt-1.5 flex items-center rounded-2xl border border-ink/15 bg-white px-3 py-2.5">
        <span className="text-sm text-ink-muted">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent pl-1 text-sm tabular-nums outline-none placeholder:text-ink-muted/50"
        />
      </span>
      {hint && <span className="mt-0.5 block text-[10px] text-ink-muted">{hint}</span>}
    </label>
  );
}
