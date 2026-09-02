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
import type { Owner } from "@/lib/json";
import type { CameraRollScanItemResult, CameraRollScanProgress } from "@/lib/jobs/queue";
import { DEFAULT_OWNERS } from "@/lib/owners";
import {
  DEFAULT_SCAN_SCENE,
  SCAN_SCENE_TYPES,
  SCENE_COPY,
  type ScanSceneType,
} from "@/lib/scan-scene";
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
  owners?: Owner[];
};

/**
 * "declare" comes before "pick" on purpose. The instruction that makes this
 * work — *select photos of yourself, where the clothes are clearly visible* —
 * was previously a sentence of helper text next to the button, and instructions
 * next to a button get skipped. It is a step with its own screen because that
 * is the only version users actually read.
 */
type Phase = "declare" | "pick" | "uploading" | "scanning" | "review" | "done";

type ReviewDraft = {
  reviewId: string;
  name: string;
  category: string;
  include: boolean;
  ghostImagePath?: string;
  originalImagePath: string;
  duplicateGroupId?: string;
  splitGroupId?: string;
  alreadyInCloset?: boolean;
  duplicateOfName?: string;
  ownerIds: string[];
  brand: string;
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
    // A group of one (after removals/ungrouping) is just a single item.
    if (list.length <= 1) {
      for (const d of list) {
        sections.push({ key: d.reviewId, isDuplicateGroup: false, drafts: [d] });
      }
    } else {
      sections.push({ key: groupId, isDuplicateGroup: true, drafts: list });
    }
  }
  return sections;
}

function imageFilesFromList(list: FileList | File[]): File[] {
  return Array.from(list).filter(isAllowedImageUpload);
}

function readyItems(result: CameraRollScanProgress): CameraRollScanItemResult[] {
  return result.items.filter((i) => i.status === "ready");
}

function draftsFromResult(
  result: CameraRollScanProgress,
  fallbackOwnerIds: string[],
): ReviewDraft[] {
  const seenGroups = new Set<string>();
  return readyItems(result).map((item) => {
    // Pieces already in the closet start unchecked; the user can still opt in.
    let include = !item.alreadyInCloset;
    if (item.duplicateGroupId) {
      if (seenGroups.has(item.duplicateGroupId)) include = false;
      else if (include) seenGroups.add(item.duplicateGroupId);
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
      alreadyInCloset: item.alreadyInCloset,
      duplicateOfName: item.duplicateOfName,
      // A resumed scan carries its own declaration; a fresh one uses what is
      // selected on screen right now.
      ownerIds: item.ownerIds?.length ? item.ownerIds : fallbackOwnerIds,
      brand: item.brand ?? "",
    };
  });
}

export function ScanClient({
  credits: initialCredits,
  realGhost,
  categories,
  owners = DEFAULT_OWNERS,
}: Props) {
  const ownerRoster = owners.length > 0 ? owners : DEFAULT_OWNERS;
  const [phase, setPhase] = useState<Phase>("declare");
  const [sceneType, setSceneType] = useState<ScanSceneType>(DEFAULT_SCAN_SCENE);
  const [batchOwnerIds, setBatchOwnerIds] = useState<string[]>(() =>
    ownerRoster[0] ? [ownerRoster[0].id] : [],
  );
  // Mode B: uploaded reference-photo paths, keyed by owner. Empty = Mode A.
  const [references, setReferences] = useState<Record<string, string[]>>({});
  const [referenceOwner, setReferenceOwner] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState<string | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
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
    setDrafts(draftsFromResult(result, batchOwnerIds));
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

    const referenceList = batchOwnerIds
      .map((ownerId) => ({ ownerId, paths: references[ownerId] ?? [] }))
      .filter((r) => r.paths.length > 0);
    const start = await startCameraRollScan(allPaths, {
      sceneType,
      ownerIds: batchOwnerIds,
      references: referenceList,
    });
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

  /**
   * Upload reference photos for one owner.
   *
   * They go through the same uploadScanBatch path as scan photos so the server
   * can verify ownership by prefix. They are never classified, never imported,
   * and the vectors derived from them are discarded when the job ends.
   */
  async function onReferenceFilesSelected(ownerId: string, files: FileList | null) {
    const list = imageFilesFromList(files ?? []).slice(0, MAX_UPLOAD_BATCH);
    if (list.length === 0) return;
    setUploadingRef(ownerId);
    setError(null);
    try {
      const formData = new FormData();
      for (const file of list) formData.append("images", file);
      const res = await uploadScanBatch(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReferences((prev) => ({ ...prev, [ownerId]: [...(prev[ownerId] ?? []), ...res.paths] }));
    } finally {
      setUploadingRef(null);
      if (refInputRef.current) refInputRef.current.value = "";
    }
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
          ownerIds: d.ownerIds,
          brand: d.brand,
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
    setPhase("declare");
    setError(null);
    setProgress(null);
    setScanResult(null);
    setReviewJobId(null);
    setDrafts([]);
    setImportSummary(null);
    setUploadLabel("");
    setReferences({});
    setReferenceOwner(null);
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

  // Remove a review item entirely — it won't import and its upload is discarded
  // at commit (any reviewId not in the selection is treated as excluded).
  function removeDraft(reviewId: string) {
    setDrafts((prev) => prev.filter((d) => d.reviewId !== reviewId));
  }

  // Pull one item out of its duplicate group into its own standalone item.
  function ungroupItem(reviewId: string) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.reviewId === reviewId ? { ...d, duplicateGroupId: undefined, include: true } : d,
      ),
    );
  }

  // Dissolve a whole "likely duplicate" group into independent items.
  function ungroupGroup(groupId: string) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.duplicateGroupId === groupId ? { ...d, duplicateGroupId: undefined, include: true } : d,
      ),
    );
    setSplitGroups((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
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
      {phase === "declare" && (
        <section className="rounded-2xl border border-ink/10 bg-surface p-8 space-y-8">
          <div className="space-y-2">
            <h2 className="font-serif text-2xl">Before you pick photos</h2>
            <p className="text-sm text-ink-muted">
              Two questions, so we read the right clothes off the right person.
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-xs uppercase tracking-wide text-ink-muted mb-2">
              What are these photos?
            </legend>
            {SCAN_SCENE_TYPES.map((option) => {
              const copy = SCENE_COPY[option];
              const checked = sceneType === option;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                    checked
                      ? "border-ink bg-paper-warm"
                      : "border-ink/10 bg-surface hover:border-ink/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="scan-scene"
                    className="sr-only"
                    checked={checked}
                    onChange={() => setSceneType(option)}
                  />
                  <span
                    aria-hidden
                    className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border transition ${
                      checked ? "border-ink bg-ink" : "border-ink/30"
                    }`}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm">{copy.label}</span>
                    <span className="block text-xs text-ink-muted">{copy.blurb}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Whose clothes are these?
            </legend>
            <div className="flex flex-wrap gap-2">
              {ownerRoster.map((owner) => {
                const checked = batchOwnerIds.includes(owner.id);
                return (
                  <label
                    key={owner.id}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs capitalize transition ${
                      checked
                        ? "bg-ink text-paper border-ink"
                        : "bg-surface border-ink/10 text-ink hover:border-ink/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(e) =>
                        setBatchOwnerIds((prev) =>
                          e.target.checked
                            ? [...prev, owner.id]
                            : prev.filter((id) => id !== owner.id),
                        )
                      }
                    />
                    {owner.name}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-ink-muted">
              Applied to everything in this batch. You can change it per piece in review.
            </p>
          </fieldset>

          {sceneType === "worn" && (
            <fieldset className="space-y-3">
              <legend className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                Scanning a whole batch? <span className="normal-case">(optional)</span>
              </legend>
              <p className="text-xs text-ink-muted">
                Add a few photos of <em>just</em> one person and we&apos;ll keep only the photos
                they&apos;re the subject of. The reference photos are used for this scan and then
                discarded — no face data is stored.
              </p>
              <input
                ref={refInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (referenceOwner) void onReferenceFilesSelected(referenceOwner, e.target.files);
                }}
              />
              <div className="space-y-2">
                {ownerRoster
                  .filter((o) => batchOwnerIds.includes(o.id))
                  .map((owner) => {
                    const count = references[owner.id]?.length ?? 0;
                    const busy = uploadingRef === owner.id;
                    return (
                      <div
                        key={owner.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-paper-warm px-3 py-2"
                      >
                        <span className="text-sm">
                          <span className="capitalize">{owner.name}</span>
                          <span className="text-ink-muted">
                            {" · "}
                            {count === 0
                              ? "no reference photos"
                              : `${count} reference photo${count === 1 ? "" : "s"}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {count > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setReferences((prev) => {
                                  const next = { ...prev };
                                  delete next[owner.id];
                                  return next;
                                })
                              }
                              className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setReferenceOwner(owner.id);
                              refInputRef.current?.click();
                            }}
                            className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:border-ink/40 transition disabled:opacity-40"
                          >
                            {busy ? "Uploading…" : count > 0 ? "Add more" : "Add photos"}
                          </button>
                        </span>
                      </div>
                    );
                  })}
              </div>
              {Object.values(references).some((p) => p.length > 0) && (
                <p className="text-xs text-ink-muted">
                  Photos where nobody enrolled is the main subject will be skipped before we spend
                  any credits on them.
                </p>
              )}
            </fieldset>
          )}

          <div className="rounded-xl border border-ink/10 bg-paper-warm p-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted mb-1">Then pick photos</p>
            <p className="text-sm">{SCENE_COPY[sceneType].instruction}</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setPhase("pick");
            }}
            disabled={batchOwnerIds.length === 0}
            className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-40 disabled:pointer-events-none"
          >
            Continue
          </button>
          {batchOwnerIds.length === 0 && (
            <p className="text-xs text-ink-muted">Pick at least one owner to continue.</p>
          )}
        </section>
      )}

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
              {SCENE_COPY[sceneType].instruction}
            </p>
            <p className="text-xs text-ink-muted max-w-md mx-auto">
              We&apos;ll detect garments so you can review before anything is saved — ghost-mannequin
              shots are generated after import, only for the pieces you keep.
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
            <p className="text-xs text-ink-muted">
              {SCENE_COPY[sceneType].label} ·{" "}
              {ownerRoster
                .filter((o) => batchOwnerIds.includes(o.id))
                .map((o) => o.name)
                .join(" + ") || "No owner"}{" "}
              <button
                type="button"
                onClick={() => setPhase("declare")}
                className="underline underline-offset-2 hover:text-ink"
              >
                Change
              </button>
            </p>
          </section>
          <MacPhotosHelp />
        </>
      )}

      {phase === "uploading" && (
        <section className="rounded-2xl border border-ink/10 bg-surface p-8 text-center space-y-4">
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
              <p className="text-xs text-ink-muted mt-1">
                Clean ghost-mannequin shots are generated after import — only for the pieces you keep.
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
                      owners={ownerRoster}
                      onSplitToggle={() => toggleSplitGroup(section.key)}
                      onSelectPrimary={(reviewId) => selectPrimaryInGroup(section.key, reviewId)}
                      onPatch={patchDraftInGroup}
                      onRemove={removeDraft}
                      onUngroupItem={ungroupItem}
                      onUngroupAll={() => ungroupGroup(section.key)}
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
                      owners={ownerRoster}
                      onPatch={patchDraft}
                      onRemove={removeDraft}
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
          {(importSummary?.imported ?? 0) > 0 && (
            <div className="mx-auto max-w-md rounded-xl border border-ink/10 bg-paper-warm p-4 text-left">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-1">
                Still working
              </p>
              <p className="text-sm text-ink">
                Your {importSummary!.imported} {importSummary!.imported === 1 ? "piece is" : "pieces are"} in
                the closet now, shown with the photo you uploaded. Clean product shots are being
                generated in the background and will replace them as each one finishes. A large
                batch can take a while — each shot is a separate generation, and slow ones are
                retried.
              </p>
              <p className="text-xs text-ink-muted mt-2">
                Safe to close this page; generation continues without it.
              </p>
            </div>
          )}
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
  owners: Owner[];
  onPatch: (reviewId: string, patch: Partial<ReviewDraft>) => void;
};

/** Small × that drops a review item from the list (discarded at commit). */
function RemoveButton({ onClick, title = "Remove from scan" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-ink/15 bg-surface text-ink-muted hover:border-red-300 hover:text-red-700 hover:bg-red-50 transition text-sm leading-none"
    >
      ×
    </button>
  );
}

function ReviewFields({ draft, categories, owners, onPatch }: ReviewFieldProps) {
  return (
    <div className="flex-1 min-w-0 space-y-2">
      {draft.alreadyInCloset && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] uppercase tracking-wide">
          Already in closet{draft.duplicateOfName ? ` · ${draft.duplicateOfName}` : ""}
        </span>
      )}
      <input
        type="text"
        value={draft.name}
        onChange={(e) => onPatch(draft.reviewId, { name: e.target.value })}
        className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-paper focus:outline-none focus:border-ink/40"
        placeholder="Name"
      />
      <input
        type="text"
        value={draft.brand}
        onChange={(e) => onPatch(draft.reviewId, { brand: e.target.value })}
        className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-paper focus:outline-none focus:border-ink/40"
        placeholder="Brand"
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
      <div className="flex flex-wrap gap-1.5">
        {owners.map((owner) => {
          const checked = draft.ownerIds.includes(owner.id);
          return (
            <label
              key={owner.id}
              className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] capitalize transition ${
                checked
                  ? "bg-ink text-paper border-ink"
                  : "bg-surface border-ink/10 text-ink-muted hover:border-ink/30"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) =>
                  onPatch(draft.reviewId, {
                    ownerIds: e.target.checked
                      ? [...draft.ownerIds, owner.id]
                      : draft.ownerIds.filter((id) => id !== owner.id),
                  })
                }
              />
              {owner.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SingleReviewItem({
  draft,
  categories,
  owners,
  onPatch,
  onRemove,
}: ReviewFieldProps & { onRemove: (reviewId: string) => void }) {
  return (
    <li
      className={`relative rounded-xl border p-3 space-y-2 transition ${
        draft.include ? "border-ink/15 bg-surface" : "border-ink/10 bg-paper-warm/50 opacity-80"
      }`}
    >
      <RemoveButton onClick={() => onRemove(draft.reviewId)} />
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
        <ReviewFields draft={draft} categories={categories} owners={owners} onPatch={onPatch} />
      </div>
    </li>
  );
}

type DuplicateGroupReviewProps = {
  groupId: string;
  drafts: ReviewDraft[];
  split: boolean;
  categories: string[];
  owners: Owner[];
  onSplitToggle: () => void;
  onSelectPrimary: (reviewId: string) => void;
  onPatch: (reviewId: string, patch: Partial<ReviewDraft>) => void;
  onToggleInclude: (reviewId: string, include: boolean) => void;
  onRemove: (reviewId: string) => void;
  onUngroupItem: (reviewId: string) => void;
  onUngroupAll: () => void;
};

function DuplicateGroupReview({
  drafts,
  split,
  categories,
  owners,
  onSplitToggle,
  onSelectPrimary,
  onPatch,
  onToggleInclude,
  onRemove,
  onUngroupItem,
  onUngroupAll,
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onUngroupAll}
            className="text-xs underline underline-offset-2 hover:text-ink"
            title="These are different pieces — split into separate items"
          >
            Not the same
          </button>
          <button
            type="button"
            onClick={onSplitToggle}
            className="text-xs underline underline-offset-2 hover:text-ink"
          >
            {split ? "Pick one only" : "Import all separately"}
          </button>
        </div>
      </div>

      {split ? (
        <ul className="space-y-2">
          {drafts.map((draft) => (
            <li key={draft.reviewId} className="relative flex gap-3 rounded-lg border border-ink/10 bg-surface/60 p-2 pr-9">
              <RemoveButton onClick={() => onRemove(draft.reviewId)} />
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
              <div className="flex-1 min-w-0 space-y-2">
                <ReviewFields draft={draft} categories={categories} owners={owners} onPatch={onPatch} />
                <button
                  type="button"
                  onClick={() => onUngroupItem(draft.reviewId)}
                  className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
                  title="Move this out of the group as its own item"
                >
                  Separate this one
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {drafts.map((draft) => (
              <div key={draft.reviewId} className="relative">
                <label
                  className={`block cursor-pointer rounded-lg border p-1 transition ${
                    draft.include
                      ? "border-accent ring-2 ring-accent/30 bg-surface"
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
                <button
                  type="button"
                  onClick={() => onRemove(draft.reviewId)}
                  title="Remove from scan"
                  aria-label="Remove from scan"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-ink/15 bg-surface text-[11px] leading-none text-ink-muted hover:border-red-300 hover:text-red-700 hover:bg-red-50 transition"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="w-16 h-20 rounded-lg overflow-hidden bg-paper-warm shrink-0 opacity-0 pointer-events-none" />
            <ReviewFields
              draft={selected}
              categories={categories}
              owners={owners}
              onPatch={onPatch}
            />
          </div>
        </>
      )}
    </li>
  );
}

function MacPhotosHelp() {
  return (
    <details className="rounded-2xl border border-ink/10 bg-surface p-4 text-sm">
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
          <pre className="text-[11px] bg-surface border border-ink/10 rounded-lg p-3 overflow-x-auto text-left">
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
