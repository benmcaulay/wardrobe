import type { CameraRollScanProgress, CameraRollScanResult } from "@/lib/jobs/queue";

export type UploadScanBatchResponse =
  | { ok: true; paths: string[]; rejected: string[] }
  | { ok: false; error: string };

export type StartCameraRollScanResponse =
  | { ok: true; jobId: string }
  | { ok: false; error: string };

export type CameraRollScanStatusResponse =
  | { ok: true; status: "queued" | "running"; progress: CameraRollScanProgress | null }
  | { ok: true; status: "review"; result: CameraRollScanResult; jobId: string }
  | { ok: true; status: "committed"; result: CameraRollScanResult; jobId: string }
  | { ok: false; error: string };

export type ActiveScanJobResponse =
  | { ok: true; jobId: string | null; mode: "scanning" | "review" | null }
  | { ok: false; error: string };

export type CommitScanReviewItemInput = {
  reviewId: string;
  name: string;
  category: string;
  include: boolean;
};

export type CommitScanReviewResponse =
  | { ok: true; imported: number; discarded: number }
  | { ok: false; error: string };
