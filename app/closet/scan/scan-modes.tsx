"use client";

/**
 * Two things you can do with your camera roll, on one page.
 *
 *   Add to closet    — bulk-import garments you own but haven't logged.
 *   Find past wears  — match photos of yourself against the closet you already
 *                      have, to recover wear history you never recorded.
 *
 * They were separate pages, which put the same first step ("pick photos from
 * your camera roll") behind two different nav entries and made you guess which
 * one you wanted. The difference isn't the input, it's what the photos are *of*
 * — garments laid out, or you wearing them — so it's a mode, not a destination.
 *
 * Deliberately not a merged flow: the import path writes new items and costs
 * credits to ghost, the wear path writes nothing but suggestions and never
 * uploads a byte. Sharing a submit button would blur two very different
 * consequences.
 *
 * Browsing Apple Photos is *not* a third mode, though it was one for a while.
 * It answers "where do these photos come from?", where the modes answer "what
 * are they of?" — a different question, so as a peer tab it read as an
 * arbitrary third option. It is a source within "Add to closet", and it only
 * appears where it can run: the picker shells out to osxphotos against the
 * library on this machine, so a hosted deploy never offers it.
 */

import { useState } from "react";
import type { Owner } from "@/lib/json";
import { PhotosPicker } from "./photos-picker";
import { ScanClient } from "./scan-client";
import { WearScanClient } from "./wear-scan-client";

type Mode = "import" | "wears";
type Source = "files" | "photos";

const MODE_LABELS: Record<Mode, string> = {
  import: "Add to closet",
  wears: "Find past wears",
};

const MODE_BLURB: Record<Mode, string> = {
  import:
    "Bulk-import clothing from your camera roll — we detect garments and let you review before anything hits your closet, then ghost the pieces you keep.",
  wears:
    "Photos of you, matched against the closet you already have. Everything runs on this device — the photos are never uploaded.",
};

const SOURCE_LABELS: Record<Source, string> = {
  files: "Choose photos",
  photos: "Photos of me",
};

export function ScanModes({
  credits,
  realGhost,
  categories,
  owners,
  embedded,
  total,
  photosBrowsing,
}: {
  credits: number;
  realGhost: boolean;
  categories: string[];
  owners: Owner[];
  embedded: number;
  total: number;
  /** False on any host without a local Photos library; hides the Photos source. */
  photosBrowsing: boolean;
}) {
  const [mode, setMode] = useState<Mode>("import");
  const [source, setSource] = useState<Source>("files");
  /*
   * The job the Photos picker just enqueued.
   *
   * ScanClient only looks for an in-flight scan when it mounts, and it mounts
   * with the page — long before the picker starts anything. Handing the id
   * across is what makes the review appear; previously the id was dropped on
   * the floor here and the scan surfaced only after a manual reload.
   */
  const [handoffJobId, setHandoffJobId] = useState<string | null>(null);

  const showingPicker = photosBrowsing && source === "photos";

  return (
    <div className="space-y-6">
      <header className="max-w-2xl">
        <h1 className="font-serif text-4xl tracking-tight">Scan camera roll</h1>
        <p className="text-ink-muted mt-2">{MODE_BLURB[mode]}</p>
      </header>

      <div
        role="radiogroup"
        aria-label="What are these photos of?"
        className="flex w-fit gap-1 rounded-full border border-ink/10 bg-paper-warm p-1"
      >
        {(["import", "wears"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            onClick={() => setMode(option)}
            className={`rounded-full px-4 py-1.5 text-xs tracking-wide transition ${
              mode === option ? "bg-ink text-paper shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {MODE_LABELS[option]}
          </button>
        ))}
      </div>

      {/* Everything stays mounted: a half-finished import review is expensive
          to lose, and glancing at the other mode shouldn't discard it. */}
      <div hidden={mode !== "import"} className="space-y-4">
        {photosBrowsing && (
          <div
            role="radiogroup"
            aria-label="Where should the photos come from?"
            className="flex w-fit gap-4 text-xs"
          >
            {(["files", "photos"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={source === option}
                onClick={() => setSource(option)}
                className={`pb-1 tracking-wide transition border-b ${
                  source === option
                    ? "text-ink border-ink"
                    : "text-ink-muted border-transparent hover:text-ink"
                }`}
              >
                {SOURCE_LABELS[option]}
              </button>
            ))}
          </div>
        )}

        {photosBrowsing && (
          <div hidden={!showingPicker}>
            <PhotosPicker
              owners={owners}
              onStarted={(jobId) => {
                setHandoffJobId(jobId);
                // The scan is running now; the review lives in ScanClient.
                setSource("files");
              }}
            />
          </div>
        )}

        {/* Unconstrained: ScanClient narrows its own form-shaped phases and
            lets the review grid use the window. */}
        <div hidden={showingPicker}>
          <ScanClient
            credits={credits}
            realGhost={realGhost}
            categories={categories}
            owners={owners}
            resumeJobId={handoffJobId}
          />
        </div>
      </div>

      <div hidden={mode !== "wears"} className="max-w-2xl">
        <WearScanClient embedded={embedded} total={total} />
      </div>
    </div>
  );
}
