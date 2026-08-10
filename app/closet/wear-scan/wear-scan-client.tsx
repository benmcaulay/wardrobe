"use client";

/**
 * Camera-roll wear scan (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * The photos are selected locally, decoded locally, embedded locally, and
 * matched locally. Nothing about them is uploaded — the copy says so plainly
 * because it is the reason anyone would agree to point this at their camera
 * roll in the first place.
 *
 * Findings land as low-confidence wears in the confirmation queue on
 * /closet/today rather than being written as fact here. Measured top-1
 * retrieval is ~70% on an easier task than this one, so asserting matches
 * would be wrong often enough to make the whole feature untrustworthy.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import type { PhotoFinding } from "@/lib/wear/photo-scan";
import type { ClosetVector } from "@/lib/wear/photo-match";
import { commitScanFindings, getClosetVectors } from "@/lib/actions/wear-scan";

type Phase = "idle" | "embedding" | "scanning" | "saving" | "done";

export function WearScanClient({
  embedded,
  total,
}: {
  embedded: number;
  total: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<PhotoFinding[]>([]);
  const [result, setResult] = useState<{ recorded: number; skipped: number } | null>(null);
  const [coverage, setCoverage] = useState({ embedded, total });

  const busy = phase !== "idle" && phase !== "done";

  async function prepareCloset(): Promise<ClosetVector[]> {
    // Matching needs a vector per item. On a closet that has never been synced
    // this is the whole wardrobe, which is the slow part of a first run —
    // hence the explicit phase rather than a silent stall.
    if (coverage.embedded < coverage.total) {
      setPhase("embedding");
      setStatus(`Preparing your closet (${coverage.embedded}/${coverage.total} ready)…`);
      // Loaded on demand: this module reaches transformers.js and the ONNX
      // runtime, which must never enter the SSR graph (they resolve to a native
      // node binding there) and shouldn't be downloaded by anyone who never
      // runs a scan.
      const { runEmbeddingSync } = await import("@/lib/wear/embedding-sync");
      const result = await runEmbeddingSync({
        allowMetered: true,
        onProgress: (p) =>
          setStatus(`Preparing your closet — ${p.done}/${p.total} pieces (${p.backend ?? "…"})`),
      });
      if (!result.ok) throw new Error("Couldn't prepare the closet on this device.");
      setCoverage({ embedded: coverage.total, total: coverage.total });
    }

    const payload = await getClosetVectors();
    return payload.map((entry) => ({
      itemId: entry.itemId,
      vector: Float32Array.from(entry.vector),
    }));
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setResult(null);
    setFindings([]);

    try {
      const closet = await prepareCloset();
      if (closet.length === 0) {
        throw new Error("No closet pieces are ready to match against yet.");
      }

      setPhase("scanning");
      const { groupFindingsByDay, scanPhotos } = await import("@/lib/wear/photo-scan");
      const list = Array.from(files);
      const found = await scanPhotos(list, closet, {
        onProgress: (p) =>
          setStatus(`Looking through ${p.done}/${p.total} photos — ${p.found} possible so far`),
      });
      setFindings(found);

      setPhase("saving");
      setStatus("Saving what it found…");
      const grouped = groupFindingsByDay(found);
      const result = await commitScanFindings(grouped);
      if (!result.ok) throw new Error(result.error);

      setResult({ recorded: result.recorded, skipped: result.skipped });
      setPhase("done");
      setStatus(null);
    } catch (err) {
      setPhase("idle");
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink/10 bg-white p-4">
        <p className="text-sm text-ink">
          Pick photos of yourself and I&rsquo;ll look for pieces you own.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Everything runs on this device — the photos are never uploaded. Matches become
          suggestions you confirm, not entries in your history.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          onChange={(e) => onFiles(e.target.files)}
          className="mt-3 block w-full text-xs text-ink-muted file:mr-3 file:rounded-full file:border file:border-ink file:bg-ink file:px-4 file:py-1.5 file:text-xs file:text-paper disabled:opacity-50"
        />

        {coverage.embedded < coverage.total ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            First run also prepares your closet ({coverage.embedded}/{coverage.total} pieces
            ready). That part is a one-off.
          </p>
        ) : null}
      </div>

      {status ? (
        <p aria-live="polite" className="rounded-xl bg-paper-warm px-3 py-2 text-xs text-ink-muted">
          {status}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {phase === "done" ? (
        <div className="rounded-2xl border border-ink/10 bg-white p-4">
          {result && result.recorded > 0 ? (
            <>
              <p className="text-sm text-ink">
                Found {findings.length} possible {findings.length === 1 ? "match" : "matches"},
                saved as {result.recorded} {result.recorded === 1 ? "day" : "days"} to confirm.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Nothing counts as worn until you say so.
              </p>
              <Link
                href="/closet/today"
                className="mt-3 inline-block rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper"
              >
                Review them
              </Link>
            </>
          ) : result && result.skipped > 0 ? (
            // Distinguish "already have it" from "found nothing" — telling
            // someone their photos matched nothing when they actually matched
            // something already recorded reads as the feature being broken.
            <>
              <p className="text-sm text-ink">Nothing new — these are already on record.</p>
              <p className="mt-1 text-xs text-ink-muted">
                Re-scanning the same photos won&rsquo;t double-count a wear.
              </p>
              <Link
                href="/closet/today"
                className="mt-3 inline-block rounded-full border border-ink bg-ink px-4 py-1.5 text-xs text-paper"
              >
                Review pending wears
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">Nothing confident enough to suggest.</p>
              <p className="mt-1 text-xs text-ink-muted">
                Matching is deliberately strict — a wrong guess costs more trust than a missed
                one is worth. Clear, well-lit photos where the garment is large in frame work
                best.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
