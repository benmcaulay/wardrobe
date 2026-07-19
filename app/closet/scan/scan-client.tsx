"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/image-paths";
import { CreditMark } from "@/components/credit-mark";
import {
  commitScanReviewItems,
  getActiveCameraRollScanJob,
  getCameraRollScanStatus,
  startCameraRollScan,
  uploadScanBatch,
} from "@/lib/actions/camera-roll-scan";
import { MAX_SCAN_PHOTOS, MAX_UPLOAD_BATCH } from "@/lib/camera-roll-scan-limits";
import type { CameraRollScanItemResult, CameraRollScanProgress } from "@/lib/jobs/queue";
import {
  IMAGE_UPLOAD_ACCEPT,
  isAllowedImageUpload,
} from "@/lib/image-upload-accept";

const POLL_INTERVAL_MS = 2000;
const SCAN_REVIEW_JOB_KEY = "wardrobe:scan-review-job";

type Props = {
  credits: number;
  realGhost: boolean;
  categories: string[];
};

type Phase = "pick" | "uploading" | "scanning" | "review" | "done";

type ReviewDraft = {
  reviewId: string;
  name: string;
  category: string;
  include: boolean;
  ghostImagePath?: string;
  originalImagePath: string;
  duplicateGroupId?: string;
  splitGroupId?: string;
};

type ReviewSection = {
  key: string;
  isDuplicateGroup: boolean;
  drafts: ReviewDraft[];
};

function buildReviewSections(drafts: ReviewDraft[]): ReviewSection[] {
  const groups = new Map<string, ReviewDraft[]>();
  const singles: ReviewDraft[] = [];
  for (const draft of drafts) {
    if (draft.duplicateGroupId) {
      const list = groups.get(draft.duplicateGroupId) ?? [];
      list.push(draft);
      groups.set(draft.duplicateGroupId, list);
    } else {
      singles.push(draft);
    }
  }
  const sections: ReviewSection[] = singles.map((draft) => ({
    key: draft.reviewId,
    isDuplicateGroup: false,
    drafts: [draft],
  }));
  for (const [groupId, list] of groups) {
    sections.push({ key: groupId, isDuplicateGroup: true, drafts: list });
  }
  return sections;
}

function imageFilesFromList(list: FileList | File[]): File[] {
  return Array.from(list).filter(isAllowedImageUpload);
}

function readyItems(result: CameraRollScanProgress): CameraRollScanItemResult[] {
  return result.items.filter((i) => i.status === "ready");
}

function draftsFromResult(result: CameraRollScanProgress): ReviewDraft[] {
  const seenGroups = new Set<string>();
  return readyItems(result).map((item) => {
    let include = true;
    if (item.duplicateGroupId) {
      if (seenGroups.has(item.duplicateGroupId)) include = false;
      else seenGroups.add(item.duplicateGroupId);
    }
    return {
      reviewId: item.reviewId,
      name: item.name ?? "Imported piece",
      category: item.category ?? "None",
      include,
      ghostImagePath: item.ghostImagePath,
      originalImagePath: item.originalImagePath,
      duplicateGroupId: item.duplicateGroupId,
      splitGroupId: item.splitGroupId,
    };
  });
}

export function ScanClient({ credits: initialCredits, realGhost, categories }: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [credits, setCredits] = useState(initialCredits);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CameraRollScanProgress | null>(null);
  const [scanResult, setScanResult] = useState<CameraRollScanProgress | null>(null);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [committing, setCommitting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ imported: number; discarded: number } | null>(
    null,
  );
  const [uploadLabel, setUploadLabel] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [splitGroups, setSplitGroups] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef(0);

  function enterReview(jobId: string, result: CameraRollScanProgress) {
    setReviewJobId(jobId);
    setScanResult(result);
    setDrafts(draftsFromResult(result));
    setSplitGroups(new Set());
    setPhase("review");
    sessionStorage.setItem(SCAN_REVIEW_JOB_KEY, jobId);
    if (typeof result.creditsRemaining === "number") setCredits(result.creditsRemaining);
  }

  const pollScan = useCallback(async (jobId: string, signal: number) => {
    while (pollRef.current === signal) {
      const status = await getCameraRollScanStatus(jobId);
      if (pollRef.current !== signal) return;
      if (!status.ok) {
        setError(status.error);
        setPhase("pick");
        return;
      }
      if (status.status === "review") {
        enterReview(status.jobId, status.result);
        return;
      }
      if (status.status === "committed") {
        setScanResult(status.result);
        setPhase("done");
        sessionStorage.removeItem(SCAN_REVIEW_JOB_KEY);
        return;
      }
      if (status.progress) {
        setProgress(status.progress);
        if (typeof status.progress.creditsRemaining === "number") {
          setCredits(status.progress.creditsRemaining);
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }, []);

  function startPolling(jobId: string) {
    setPhase("scanning");
    sessionStorage.setItem(SCAN_REVIEW_JOB_KEY, jobId);
    const signal = ++pollRef.current;
    void pollScan(jobId, signal);
  }

  useEffect(() => {
    void (async () => {
      const active = await getActiveCameraRollScanJob();
      if (!active.ok || !active.jobId) return;
      if (active.mode === "scanning") {
        startPolling(active.jobId);
        return;
      }
      if (active.mode === "review") {
        const status = await getCameraRollScanStatus(active.jobId);
        if (status.ok && status.status === "review") {
          enterReview(status.jobId, status.result);
        }
      }
    })();
    return () => {
      pollRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processFiles(files: File[]) {
    if (files.length === 0) {
      setError("No supported images found (JPG, PNG, WebP, or HEIC).");
      return;
    }
    setError(null);
    const list = files.slice(0, MAX_SCAN_PHOTOS);
    if (files.length > MAX_SCAN_PHOTOS) {
      setError(`Only the first ${MAX_SCAN_PHOTOS} photos will be scanned.`);
    }

    setPhase("uploading");
    setUploadLabel(`Uploading 0 / ${list.length}…`);
    const allPaths: string[] = [];

    for (let i = 0; i < list.length; i += MAX_UPLOAD_BATCH) {
      const batch = list.slice(i, i + MAX_UPLOAD_BATCH);
      const formData = new FormData();
      for (const file of batch) formData.append("images", file);
      setUploadLabel(`Uploading ${Math.min(i + batch.length, list.length)} / ${list.length}…`);
      const res = await uploadScanBatch(formData);
      if (!res.ok) {
        setError(res.error);
        setPhase("pick");
        return;
      }
      allPaths.push(...res.paths);
    }

    const start = await startCameraRollScan(allPaths);
    if (!start.ok) {
      setError(start.error);
      setPhase("pick");
      return;
    }
    setProgress({
      total: allPaths.length,
      processed: 0,
      ready: 0,
      skipped: 0,
      failed: 0,
      items: [],
    });
    startPolling(start.jobId);
  }

  async function onFilesSelected(files: FileList | null) {
    if (!files?.length) return;
    await processFiles(imageFilesFromList(files));
  }

  async function onCommitReview() {
    if (!reviewJobId || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await commitScanReviewItems(
        reviewJobId,
        drafts.map((d) => ({
          reviewId: d.reviewId,
          name: d.name,
          category: d.category,
          include: d.include,
        })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportSummary({ imported: res.imported, discarded: res.discarded });
      sessionStorage.removeItem(SCAN_REVIEW_JOB_KEY);
      setPhase("done");
    } finally {
      setCommitting(false);
    }
  }

  async function onCancelReview() {
    if (!reviewJobId) {
      resetScan();
      return;
    }
    setCommitting(true);
    await commitScanReviewItems(
      reviewJobId,
      drafts.map((d) => ({
        reviewId: d.reviewId,
        name: d.name,
        category: d.category,
        include: false,
      })),
    );
    setCommitting(false);
    resetScan();
  }

  function resetScan() {
    pollRef.current += 1;
    setPhase("pick");
    setError(null);
    setProgress(null);
    setScanResult(null);
    setReviewJobId(null);
    setDrafts([]);
    setImportSummary(null);
    setUploadLabel("");
    sessionStorage.removeItem(SCAN_REVIEW_JOB_KEY);
    if (inputRef.current) inputRef.current.value = "";
  }

  function patchDraft(reviewId: string, patch: Partial<ReviewDraft>) {
    setDrafts((prev) => prev.map((d) => (d.reviewId === reviewId ? { ...d, ...patch } : d)));
  }

  function selectPrimaryInGroup(groupId: string, reviewId: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.duplicateGroupId !== groupId || splitGroups.has(groupId)) return d;
        return { ...d, include: d.reviewId === reviewId };
      }),
    );
  }

  function toggleSplitGroup(groupId: string) {
    setSplitGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
        setDrafts((drafts) => {
          let picked = false;
          return drafts.map((d) => {
            if (d.duplicateGroupId !== groupId) return d;
            if (!picked) {
              picked = true;
              return { ...d, include: true };
            }
            return { ...d, include: false };
          });
        });
      } else {
        next.add(groupId);
        setDrafts((drafts) =>
          drafts.map((d) =>
            d.duplicateGroupId === groupId ? { ...d, include: true } : d,
          ),
        );
      }
      return next;
    });
  }

  function patchDraftInGroup(reviewId: string, patch: Partial<ReviewDraft>) {
    setDrafts((prev) => {
      const target = prev.find((d) => d.reviewId === reviewId);
      const syncNameCategory =
        target?.duplicateGroupId &&
        !splitGroups.has(target.duplicateGroupId) &&
        (patch.name !== undefined || patch.category !== undefined);
      return prev.map((d) => {
        if (d.reviewId === reviewId) return { ...d, ...patch };
        if (
          syncNameCategory &&
          d.duplicateGroupId === target.duplicateGroupId &&
          (patch.name !== undefined || patch.category !== undefined)
        ) {
          return {
            ...d,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.category !== undefined ? { category: patch.category } : {}),
          };
        }
        return d;
      });
    });
  }

  const selectedCount = drafts.filter((d) => d.include).length;
  const duplicateGroupCount = new Set(
    drafts.filter((d) => d.duplicateGroupId).map((d) => d.duplicateGroupId),
  ).size;
  const splitPhotoCount = new Set(
    drafts.filter((d) => d.splitGroupId).map((d) => d.splitGroupId),
  ).size;
  const reviewSections = buildReviewSections(drafts);
  const skippedCount = scanResult?.skipped ?? progress?.skipped ?? 0;
  const failedItems =
    scanResult?.items.filter((i) => i.status === "failed") ??
    progress?.items.filter((i) => i.status === "failed") ??
    [];

  return (
    <div className="space-y-8">
      {phase === "pick" && (
        <>
          <section
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              void onFilesSelected(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed p-8 text-center space-y-4 transition ${
              dragActive ? "border-accent bg-accent-soft/20" : "border-ink/15 bg-paper-warm"
            }`}
          >
            <p className="font-serif text-2xl">Drop photos here</p>
            <p className="text-sm text-ink-muted max-w-md mx-auto">
              We&apos;ll ghost garments in the background, then you review before anything is saved.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <CreditMark className="h-3.5 w-3.5" title="Credits" />
                {credits} credits
              </span>
              <span>·</span>
              <span>Up to {MAX_SCAN_PHOTOS} photos per scan</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
            >
              Choose photos…
            </button>
          </section>
          <MacPhotosHelp />
        </>
      )}

      {phase === "uploading" && (
        <section className="rounded-2xl border border-ink/10 bg-white p-8 text-center space-y-4">
          <p className="text-sm text-ink-muted">{uploadLabel}</p>
          <Link
            href="/closet"
            className="inline-block rounded-full border border-ink/15 px-6 py-2 text-sm hover:bg-paper-warm transition"
          >
            Back to closet
          </Link>
        </section>
      )}

      {phase === "scanning" && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl">Scanning…</h2>
          <p className="text-sm text-ink-muted">
            {progress
              ? `${progress.processed} / ${progress.total} · ${progress.ready} garments found`
              : "Starting…"}
          </p>
          {progress && progress.total > 0 && (
            <div className="h-2 rounded-full bg-ink/10 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-sm text-ink-muted">
            Processing continues in the background. Come back here when you&apos;re ready to review.
          </p>
          <Link
            href="/closet"
            className="inline-block rounded-full border border-ink/15 px-6 py-2 text-sm hover:bg-paper-warm transition"
          >
            Back to closet
          </Link>
        </section>
      )}

      {phase === "review" && scanResult && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl">Review before importing</h2>
              <p className="text-sm text-ink-muted mt-1">
                {drafts.length} garment{drafts.length === 1 ? "" : "s"} ready
                {duplicateGroupCount > 0
                  ? ` · ${duplicateGroupCount} duplicate group${duplicateGroupCount === 1 ? "" : "s"}`
                  : ""}
                {splitPhotoCount > 0
                  ? ` · ${splitPhotoCount} multi-item photo${splitPhotoCount === 1 ? "" : "s"} split`
                  : ""}
                {skippedCount > 0 ? ` · ${skippedCount} non-clothing skipped` : ""}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <CreditMark className="h-3.5 w-3.5" title="Credits" />
              {credits} credits
            </span>
          </div>

          {drafts.length === 0 ? (
            <button
              type="button"
              onClick={() => void onCommitReview()}
              disabled={committing}
              className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
            >
              {committing ? "Finishing…" : "Done"}
            </button>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.map((d) => ({ ...d, include: true })))}
                  className="rounded-full border border-ink/15 px-3 py-1 hover:bg-paper-warm"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.map((d) => ({ ...d, include: false })))}
                  className="rounded-full border border-ink/15 px-3 py-1 hover:bg-paper-warm"
                >
                  Select none
                </button>
              </div>
              <ul className="space-y-3 max-h-[32rem] overflow-auto pr-1">
                {reviewSections.map((section) =>
                  section.isDuplicateGroup ? (
                    <DuplicateGroupReview
                      key={section.key}
                      groupId={section.key}
                      drafts={section.drafts}
                      split={splitGroups.has(section.key)}
                      categories={categories}
                      onSplitToggle={() => toggleSplitGroup(section.key)}
                      onSelectPrimary={(reviewId) => selectPrimaryInGroup(section.key, reviewId)}
                      onPatch={patchDraftInGroup}
                      onToggleInclude={(reviewId, include) => {
                        if (splitGroups.has(section.key)) {
                          patchDraft(reviewId, { include });
                        } else if (include) {
                          selectPrimaryInGroup(section.key, reviewId);
                        }
                      }}
                    />
                  ) : (
                    <SingleReviewItem
                      key={section.key}
                      draft={section.drafts[0]!}
                      categories={categories}
                      onPatch={patchDraft}
                    />
                  ),
                )}
              </ul>
            </>
          )}

          {drafts.length === 0 && (
            <p className="text-sm text-ink-muted">No garments to import from this scan.</p>
          )}

          {failedItems.length > 0 && (
            <details className="text-xs text-ink-muted">
              <summary>{failedItems.length} failed</summary>
              <ul className="mt-2 space-y-1">
                {failedItems.map((item) => (
                  <li key={item.reviewId}>{item.error ?? "Generation failed"}</li>
                ))}
              </ul>
            </details>
          )}

          {drafts.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => void onCommitReview()}
                disabled={committing || selectedCount === 0}
                className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
              >
                {committing ? "Importing…" : `Add ${selectedCount} to closet`}
              </button>
              <button
                type="button"
                onClick={() => void onCancelReview()}
                disabled={committing}
                className="rounded-full border border-ink/15 px-6 py-2 text-sm hover:bg-paper-warm transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {drafts.length > 0 && (
            <p className="text-[11px] text-ink-muted">
              Unchecked items are discarded and their files deleted. Ghost credits were already used
              for generated previews.
            </p>
          )}
        </section>
      )}

      {phase === "done" && (
        <section className="space-y-4 text-center">
          <h2 className="font-serif text-2xl">All set</h2>
          <p className="text-sm text-ink-muted">
            {importSummary
              ? `${importSummary.imported} added to your closet${importSummary.discarded > 0 ? ` · ${importSummary.discarded} discarded` : ""}`
              : scanResult
                ? `${scanResult.ready} ready · ${scanResult.skipped} skipped`
                : "Scan complete"}
          </p>
          <div className="flex flex-wrap gap-3 justify-center pt-2">
            <Link
              href="/closet"
              className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
            >
              View closet
            </Link>
            <button
              type="button"
              onClick={resetScan}
              className="rounded-full border border-ink/15 px-6 py-2 text-sm hover:bg-paper-warm transition"
            >
              Scan more
            </button>
          </div>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3"
        >
          {error}
        </p>
      )}
    </div>
  );
}

type ReviewFieldProps = {
  draft: ReviewDraft;
  categories: string[];
  onPatch: (reviewId: string, patch: Partial<ReviewDraft>) => void;
};

function ReviewFields({ draft, categories, onPatch }: ReviewFieldProps) {
  return (
    <div className="flex-1 min-w-0 space-y-2">
      <input
        type="text"
        value={draft.name}
        onChange={(e) => onPatch(draft.reviewId, { name: e.target.value })}
        className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-paper focus:outline-none focus:border-ink/40"
        placeholder="Name"
      />
      <select
        value={draft.category}
        onChange={(e) => onPatch(draft.reviewId, { category: e.target.value })}
        className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-paper focus:outline-none focus:border-ink/40"
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}

function SingleReviewItem({
  draft,
  categories,
  onPatch,
}: ReviewFieldProps) {
  return (
    <li
      className={`rounded-xl border p-3 space-y-2 transition ${
        draft.include ? "border-ink/15 bg-white" : "border-ink/10 bg-paper-warm/50 opacity-80"
      }`}
    >
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={draft.include}
          onChange={(e) => onPatch(draft.reviewId, { include: e.target.checked })}
          className="mt-1 accent-ink"
          aria-label="Import this piece"
        />
        <div className="w-16 h-20 rounded-lg overflow-hidden bg-paper-warm shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(draft.ghostImagePath ?? draft.originalImagePath)}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <ReviewFields draft={draft} categories={categories} onPatch={onPatch} />
      </div>
    </li>
  );
}

type DuplicateGroupReviewProps = {
  groupId: string;
  drafts: ReviewDraft[];
  split: boolean;
  categories: string[];
  onSplitToggle: () => void;
  onSelectPrimary: (reviewId: string) => void;
  onPatch: (reviewId: string, patch: Partial<ReviewDraft>) => void;
  onToggleInclude: (reviewId: string, include: boolean) => void;
};

function DuplicateGroupReview({
  drafts,
  split,
  categories,
  onSplitToggle,
  onSelectPrimary,
  onPatch,
  onToggleInclude,
}: DuplicateGroupReviewProps) {
  const selected = drafts.find((d) => d.include) ?? drafts[0]!;
  const anyIncluded = drafts.some((d) => d.include);

  return (
    <li
      className={`rounded-xl border p-3 space-y-3 transition ${
        anyIncluded ? "border-accent/30 bg-accent-soft/10" : "border-ink/10 bg-paper-warm/50 opacity-80"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          Likely duplicate · {drafts.length} photos of the same piece
        </p>
        <button
          type="button"
          onClick={onSplitToggle}
          className="text-xs underline underline-offset-2 hover:text-ink"
        >
          {split ? "Pick one only" : "Import all separately"}
        </button>
      </div>

      {split ? (
        <ul className="space-y-2">
          {drafts.map((draft) => (
            <li key={draft.reviewId} className="flex gap-3">
              <input
                type="checkbox"
                checked={draft.include}
                onChange={(e) => onToggleInclude(draft.reviewId, e.target.checked)}
                className="mt-1 accent-ink"
                aria-label="Import this angle"
              />
              <div className="w-14 h-[4.5rem] rounded-lg overflow-hidden bg-paper-warm shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(draft.ghostImagePath ?? draft.originalImagePath)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <ReviewFields draft={draft} categories={categories} onPatch={onPatch} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {drafts.map((draft) => (
              <label
                key={draft.reviewId}
                className={`cursor-pointer rounded-lg border p-1 transition ${
                  draft.include
                    ? "border-accent ring-2 ring-accent/30 bg-white"
                    : "border-ink/10 bg-paper-warm/60 hover:border-ink/25"
                }`}
              >
                <input
                  type="radio"
                  name={`dup-${draft.duplicateGroupId}`}
                  checked={draft.include}
                  onChange={() => onSelectPrimary(draft.reviewId)}
                  className="sr-only"
                />
                <div className="w-16 h-20 rounded-md overflow-hidden bg-paper-warm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(draft.ghostImagePath ?? draft.originalImagePath)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="w-16 h-20 rounded-lg overflow-hidden bg-paper-warm shrink-0 opacity-0 pointer-events-none" />
            <ReviewFields draft={selected} categories={categories} onPatch={onPatch} />
          </div>
        </>
      )}
    </li>
  );
}

function MacPhotosHelp() {
  return (
    <details className="rounded-2xl border border-ink/10 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-ink select-none">
        Using Apple Photos on Mac
      </summary>
      <div className="mt-3 space-y-3 text-ink-muted text-xs leading-relaxed">
        <p>
          <strong className="text-ink">Quick pick:</strong> drag photos from Photos onto the drop
          zone, or use Choose photos and select <strong className="text-ink">Photos</strong> in the
          sidebar (up to {MAX_SCAN_PHOTOS} at a time).
        </p>
        <div className="rounded-xl bg-paper-warm/80 border border-ink/10 p-3 space-y-2">
          <p className="font-medium text-ink">Scan your whole library (Mac CLI)</p>
          <p>
            Browsers can&apos;t read the Photos library directly. On this Mac, install{" "}
            <a
              href="https://github.com/RhetTbull/osxphotos"
              className="text-ink underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              osxphotos
            </a>{" "}
            (<code className="text-[11px]">pip install osxphotos</code>), grant Terminal access under{" "}
            <strong className="text-ink">System Settings → Privacy → Photos</strong>, then run:
          </p>
          <pre className="text-[11px] bg-white border border-ink/10 rounded-lg p-3 overflow-x-auto text-left">
            {`WARDROBE_USER_EMAIL=you@example.com pnpm mac-photos:scan

# optional filters:
pnpm mac-photos:scan -- --limit 200 --from-date 2023-01-01`}
          </pre>
          <p>
            The script exports batches from Photos, uploads them, and enqueues scan jobs. Open{" "}
            <Link href="/closet/scan" className="text-ink underline underline-offset-2">
              Scan
            </Link>{" "}
            in the browser to review results (make sure <code className="text-[11px]">pnpm worker</code>{" "}
            is running).
          </p>
        </div>
      </div>
    </details>
  );
}
