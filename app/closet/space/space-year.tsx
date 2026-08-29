/**
 * Twelve months, in above the line and out below it.
 *
 * A mirrored bar pair rather than a single net line, because the net hides the
 * thing worth seeing: a quiet month and a month where twelve pieces came in and
 * eleven went out both net to one, and they are nothing alike. Two directions
 * off a shared axis keeps both halves visible.
 *
 * A server component — no state, no interaction, no clock. Heights come from
 * the largest bar in the series, so the chart is honest about proportion within
 * the year and makes no claim about any target. There is deliberately no
 * gridline, no y-axis and no number printed on each bar: the shape is the point,
 * and the exact figures for the current month are already stated above it.
 */

import type { LedgerMonth } from "@/lib/space/ledger";

/** px available to the tallest bar in either direction. */
const ARM = 46;

export function SpaceYear({ months }: { months: LedgerMonth[] }) {
  const peak = Math.max(1, ...months.map((m) => Math.max(m.in, m.out)));
  const empty = months.every((m) => m.in === 0 && m.out === 0);

  if (empty) {
    return (
      <p className="rounded-2xl border border-ink/10 bg-paper-warm px-6 py-8 text-sm text-ink-muted">
        Nothing has come in or gone out in the last year, so there is no shape to show yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-sm bg-ink/70" />
          In
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-sm bg-accent" />
          Out
        </span>
      </div>

      {/*
        A real table under the chart, visually hidden. The bars carry no
        numbers, which is right for the shape and useless to a screen reader —
        so the figures go out as a table rather than as twelve aria-labels a
        reader has to walk one at a time.
      */}
      {/*
        One axis line behind all twelve columns, not a 1px rule inside each.
        Per-column rules let the flex gap show through, so the axis rendered as
        twelve dashes and read as a styling accident rather than a baseline.
      */}
      <div className="relative mt-3">
        <span aria-hidden className="absolute inset-x-0 h-px bg-ink/20" style={{ top: ARM }} />
        <ul className="flex items-stretch gap-1.5" aria-hidden>
          {months.map((month) => (
            <li key={month.startMs} className="flex min-w-0 flex-1 flex-col items-center">
              <div
                className="flex w-full flex-col items-center justify-end"
                style={{ height: ARM }}
              >
                <span
                  className="w-full max-w-[26px] rounded-t-sm bg-ink/70"
                  style={{ height: barHeight(month.in, peak) }}
                />
              </div>
              <div
                className="flex w-full flex-col items-center justify-start"
                style={{ height: ARM }}
              >
                <span
                  className="w-full max-w-[26px] rounded-b-sm bg-accent"
                  style={{ height: barHeight(month.out, peak) }}
                />
              </div>
              <span className="mt-1.5 text-[10px] text-ink-muted">
                {monthInitial(month.startMs)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <table className="sr-only">
        <caption>Pieces in and out by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.startMs}>
              <th scope="row">{monthFull(month.startMs)}</th>
              <td>{month.in}</td>
              <td>{month.out}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A count of zero gets no bar at all, not a 1px sliver: a hairline reads as
 * "almost none" when the truth is "none".
 */
function barHeight(count: number, peak: number): number {
  if (count <= 0) return 0;
  // Floor of 3px so a month with one piece is visible next to a month with
  // thirty, which is the whole reason the axis is shared.
  return Math.max(3, Math.round((count / peak) * ARM));
}

function monthInitial(startMs: number): string {
  return new Date(startMs).toLocaleString("en-US", { month: "narrow" });
}

function monthFull(startMs: number): string {
  return new Date(startMs).toLocaleString("en-US", { month: "long", year: "numeric" });
}
