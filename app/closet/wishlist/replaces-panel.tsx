"use client";

/**
 * "What this replaces" — the one-in-one-out prompt.
 *
 * Collapsed by default and never required. It is a question, not a gate: the
 * app has no opinion about whether you buy the thing, and a wishlist that
 * argues with you is a wishlist you stop using. See lib/space/replaces.ts for
 * why nothing here is stored.
 *
 * The ordering is printed on the panel rather than left to be inferred. That
 * matters: ranking the closet unprompted is exactly what the observation lenses
 * refuse to do (lenses-client.tsx), and the only reason it is allowed here is
 * that the user asked this specific question by opening the panel. Saying
 * "longest unworn first" out loud is what keeps it an answer instead of a
 * verdict.
 */

import Link from "next/link";
import { imageUrl } from "@/lib/image-paths";
import { formatLastWorn } from "@/lib/space/rail";
import type { ReplaceCandidate } from "@/lib/space/replaces";

type Props = {
  category: string;
  candidates: ReplaceCandidate[];
  /** Everything filed under this category, which may exceed `candidates`. */
  totalInCategory: number;
  /** Server clock, so "worn 3 weeks ago" is identical on both sides. */
  nowMs: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ReplacesPanel({ category, candidates, totalInCategory, nowMs }: Props) {
  // Nothing owned in this shape: the honest answer is that it replaces nothing,
  // and a disclosure that opens onto "none" is worse than no disclosure.
  if (totalInCategory === 0) return null;

  return (
    <details className="mt-3 rounded-xl bg-paper-warm/70 px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none text-ink-muted transition hover:text-ink">
        What this replaces{" "}
        <span className="tabular-nums">· you own {totalInCategory} already</span>
      </summary>

      <p className="mt-2 text-ink-muted">
        Filed under {category}, longest unworn first. Nothing has to go — this is just what&apos;s
        already there.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-2.5">
        {candidates.map((candidate) => {
          const days =
            candidate.lastWornAtMs == null
              ? null
              : Math.max(0, Math.floor((nowMs - candidate.lastWornAtMs) / MS_PER_DAY));
          return (
            <li key={candidate.id}>
              <Link
                href={`/closet/${candidate.id}`}
                title={`${candidate.name} — ${formatLastWorn(days)}`}
                className="block w-16 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(candidate.imagePath)}
                  alt={candidate.name}
                  loading="lazy"
                  className="h-16 w-16 rounded-lg border border-ink/10 bg-surface object-cover transition hover:border-ink/30"
                />
                <span className="mt-1 block truncate text-[10px] text-ink-muted">
                  {formatLastWorn(days)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {totalInCategory > candidates.length ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          {totalInCategory - candidates.length} more filed under {category}.
        </p>
      ) : null}

      {/* The action, not a promise. Anything actually leaving goes through the
          same pile as everything else. */}
      <Link
        href="/closet/sell/triage"
        className="mt-2.5 inline-block text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Sort these into keep or make space →
      </Link>
    </details>
  );
}
