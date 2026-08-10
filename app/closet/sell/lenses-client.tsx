"use client";

/**
 * The observation surfaces (docs/OUTFIT_INTELLIGENCE.md §6).
 *
 * Every word here is load-bearing. The lenses report facts — "last worn 14
 * months ago", "you own four similar tees", "pieces like this sell for about
 * $40" — and stop. There is no "sell this", no "consider letting go", no
 * decluttering language anywhere in this file, and the three sections are
 * visually separate so nobody reads dormancy and resale value as one verdict.
 *
 * That restraint matters more now than it did, because this lives on the Sell
 * page: the surrounding context already implies an action, so nothing in here
 * may add one. No CTA, no "list it", no ordering that reads as a queue. The
 * caller is responsible for keeping the section visibly apart from the earnings
 * above it — see the divider and standfirst in sell-landing.tsx.
 *
 * The dormancy section refuses to render at all until there is enough wear
 * history for it to mean something. On a young closet every garment is
 * technically dormant, which makes the statement both useless and accusatory —
 * the fastest way to lose the trust this whole design is arranged around.
 */

import { imageUrl } from "@/lib/image-paths";
import { MIN_HISTORY_DAYS, MIN_WEAR_EVENTS } from "@/lib/outfit/dormancy";
import type { ClosetLenses, LensItem } from "@/lib/actions/closet-lenses";

function Thumb({ item }: { item: LensItem }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={imageUrl(item.imagePath)}
      alt={item.name}
      className="h-14 w-14 rounded-lg border border-ink/10 bg-paper object-cover"
    />
  );
}

export function LensesClient({ lenses }: { lenses: ClosetLenses }) {
  const { readiness, dormant, redundant, valuable } = lenses;
  const nothing =
    readiness.ready && dormant.length === 0 && redundant.length === 0 && valuable.length === 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="text-sm font-medium text-ink">Quietest pieces</h2>

        {!readiness.ready ? (
          <p className="mt-2 text-xs text-ink-muted">
            Not enough wear history yet to say anything useful — right now every piece would
            look neglected, which tells you nothing.{" "}
            {readiness.reason === "too-few-wears"
              ? `${readiness.wearEvents} of ${MIN_WEAR_EVENTS} wears logged.`
              : `${readiness.historyDays} of ${MIN_HISTORY_DAYS} days of history.`}
          </p>
        ) : dormant.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            Nothing stands out — you&rsquo;re wearing most of what you own.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dormant.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Thumb item={item} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{item.name}</p>
                  <p className="text-xs text-ink-muted">{item.line}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {redundant.length > 0 ? (
        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h2 className="text-sm font-medium text-ink">Close cousins</h2>
          <ul className="mt-3 space-y-3">
            {redundant.map((cluster) => (
              <li key={cluster.category + cluster.items[0]?.id}>
                <p className="text-xs text-ink-muted">{cluster.line}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cluster.items.map((item) => (
                    <Thumb key={item.id} item={item} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {valuable.length > 0 ? (
        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          {/* Deliberately its own section, far from dormancy: joining the two
              would turn two facts into a recommendation nobody asked for. */}
          <h2 className="text-sm font-medium text-ink">Holding their value</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Based on what your own listings have actually sold for.
          </p>
          <ul className="mt-3 space-y-2">
            {valuable.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Thumb item={item} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{item.name}</p>
                  <p className="text-xs text-ink-muted">{item.line}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {nothing ? (
        <p className="text-xs text-ink-muted">Nothing to report — the closet looks healthy.</p>
      ) : null}
    </div>
  );
}
