import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/sale-listing";
import { formatRailInches } from "@/lib/space/ledger";
import { loadSpaceSnapshot, SPACE_MONTHS } from "@/lib/server/space-ledger";
import { BrandMark } from "@/components/brand-mark";
import { Wordmark } from "@/components/wordmark";
import { SpaceYear } from "./space-year";

export const dynamic = "force-dynamic";

/**
 * The space ledger.
 *
 * Four readings and a subtraction, laid out with more empty page than content —
 * the one screen where the whitespace scale (the Room block in
 * app/globals.css) is doing argumentative work rather than decorative work.
 *
 * There is no score here, and the layout is part of why: the four figures sit
 * in a row as equals with no total under them and no ring, dial, or bar
 * implying a target. That restraint is inherited from the observation lenses
 * (lib/actions/closet-lenses.ts), which return dormancy, redundancy and value
 * separately precisely so a caller cannot render them as one verdict. Same rule
 * applies to everything on this page.
 */
export default async function SpacePage() {
  const user = await requireUser();
  const space = await loadSpaceSnapshot(user.id);
  const { month, allTime, months, ownedCount } = space;

  const monthName = new Date(space.nowMs).toLocaleString("en-US", { month: "long" });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      {/* pr-28 clears the fixed menu trigger (app/closet/layout.tsx). */}
      <nav className="mb-6 flex items-center justify-between pr-28 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
        <Link href="/closet/share" className="hover:text-ink">
          Share this →
        </Link>
      </nav>

      <header className="mb-room">
        <div className="flex items-center gap-2.5 text-ink-muted">
          <BrandMark size={20} className="shrink-0" />
          <Wordmark
            piecesOut={month.out.count}
            className="font-sans text-[11px] font-medium uppercase tracking-[0.2em]"
          />
        </div>
        <h1 className="mt-5 font-serif text-5xl tracking-tight">Space</h1>
        <p className="mt-3 max-w-xl text-ink-muted">
          What came in, what went out, and what that freed. Four separate
          numbers — there is no total, because adding them together wouldn&apos;t
          mean anything.
        </p>
      </header>

      {/* ── This month ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          {monthName} so far
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Reading label="In" value={month.in.count} hint="pieces added" />
          <Reading label="Out" value={month.out.count} hint="pieces sold" />
          <Reading
            label="Rail freed"
            value={formatRailInches(month.rail.inches)}
            /* The word "about" is in the value itself; this says why. */
            hint="estimated by garment kind"
          />
          <Reading
            label="Back"
            value={formatCents(month.money.grossCents) || "$0"}
            hint="gross, before fees"
          />
        </dl>

        <p className="mt-5 text-sm text-ink-muted">
          {netSentence(month.net, ownedCount)}
        </p>

        {month.undated.count > 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {month.undated.count} {month.undated.count === 1 ? "sale has" : "sales have"} no
            recorded date, so {month.undated.count === 1 ? "it isn't" : "they aren't"} in the
            month above. {formatCents(month.undated.grossCents)} of the all-time total.
          </p>
        ) : null}
      </section>

      {/* An empty band, on purpose. The Room scale exists so this is a decision
          with a name rather than a margin somebody liked the look of. */}
      <div aria-hidden className="h-room-loose" />

      {/* ── The year ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          The last {SPACE_MONTHS} months
        </h2>
        <div className="mt-5">
          <SpaceYear months={months} />
        </div>
      </section>

      <div aria-hidden className="h-room-loose" />

      {/* ── All time ───────────────────────────────────────────────────────── */}
      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">Ever</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Reading label="In" value={allTime.in.count} hint="pieces ever added" />
          <Reading label="Out" value={allTime.out.count} hint="pieces ever sold" />
          <Reading
            label="Rail freed"
            value={formatRailInches(allTime.rail.inches)}
            hint="estimated by garment kind"
          />
          <Reading
            label="Back"
            value={formatCents(allTime.money.grossCents) || "$0"}
            hint="gross, before fees"
          />
        </dl>
        <p className="mt-5 text-sm text-ink-muted">
          {ownedCount} {ownedCount === 1 ? "piece" : "pieces"} in the closet right now.{" "}
          <Link href="/closet/share" className="underline underline-offset-2 hover:text-ink">
            Share the year
          </Link>{" "}
          — counts only, no photos and no money.
        </p>
      </section>
    </main>
  );
}

/**
 * One reading. No sparkline, no delta-versus-last-month, no colour that means
 * good or bad — a figure and what it counts.
 */
function Reading({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-paper-warm px-4 py-4">
      <dd className="font-serif text-3xl tracking-tight tabular-nums">{value}</dd>
      <dt className="mt-1 text-[11px] uppercase tracking-[0.1em] text-ink-muted">{label}</dt>
      <p className="mt-0.5 text-[10px] text-ink-muted/80">{hint}</p>
    </div>
  );
}

/**
 * The net, in words rather than as a signed number with a red or green arrow.
 *
 * A growing closet is a fact about a month, not a failure, and "3 more in than
 * out" is the sentence a person would actually say. `net` is a subtraction of
 * two of the readings above and is never presented as a score — see
 * lib/space/ledger.ts.
 */
function netSentence(net: number, ownedCount: number): string {
  if (net === 0) {
    return ownedCount === 0
      ? "Nothing in, nothing out."
      : "As many pieces came in as went out.";
  }
  if (net > 0) {
    return `${net} more ${net === 1 ? "piece" : "pieces"} went out than came in.`;
  }
  const grew = Math.abs(net);
  return `${grew} more ${grew === 1 ? "piece" : "pieces"} came in than went out.`;
}
