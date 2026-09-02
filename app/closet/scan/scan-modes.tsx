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
 */

import { useState } from "react";
import type { Owner } from "@/lib/json";
import { PhotosPicker } from "./photos-picker";
import { ScanClient } from "./scan-client";
import { WearScanClient } from "./wear-scan-client";

type Mode = "browse" | "import" | "wears";

const MODE_LABELS: Record<Mode, string> = {
  browse: "Browse photos of me",
  import: "Add to closet",
  wears: "Find past wears",
};

const MODE_BLURB: Record<Mode, string> = {
  browse:
    "Photos Apple has already tagged as you, browsable here. Pick the ones with a clear garment, crop to yourself if it helps, and only those get classified.",
  import:
    "Bulk-import clothing from Apple Photos or your camera roll — we detect garments and let you review before anything hits your closet, then ghost the pieces you keep.",
  wears:
    "Photos of you, matched against the closet you already have. Everything runs on this device — the photos are never uploaded.",
};

export function ScanModes({
  credits,
  realGhost,
  categories,
  owners,
  embedded,
  total,
}: {
  credits: number;
  realGhost: boolean;
  categories: string[];
  owners: Owner[];
  embedded: number;
  total: number;
}) {
  const [mode, setMode] = useState<Mode>("import");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-4xl tracking-tight">Scan camera roll</h1>
        <p className="text-ink-muted mt-2">{MODE_BLURB[mode]}</p>
      </header>

      <div
        role="radiogroup"
        aria-label="What are these photos of?"
        className="flex w-fit gap-1 rounded-full border border-ink/10 bg-paper-warm p-1"
      >
        {(["browse", "import", "wears"] as const).map((option) => (
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

      {/* Both stay mounted: a half-finished import review is expensive to lose,
          and flipping over to check the other mode shouldn't discard it. */}
      <div hidden={mode !== "browse"}>
        <PhotosPicker owners={owners} onStarted={() => setMode("import")} />
      </div>

      <div hidden={mode !== "import"}>
        <ScanClient
          credits={credits}
          realGhost={realGhost}
          categories={categories}
          owners={owners}
        />
      </div>
      <div hidden={mode !== "wears"}>
        <WearScanClient embedded={embedded} total={total} />
      </div>
    </div>
  );
}
