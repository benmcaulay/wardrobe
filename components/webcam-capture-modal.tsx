"use client";

import { useEffect, useRef, useState } from "react";

export type WebcamFacingPreference = "environment" | "user";

type Props = {
  open: boolean;
  /** Prefer rear/“world” camera (garments) or front/“user” (selfies). Desktop usually has one camera. */
  preferredFacing: WebcamFacingPreference;
  title?: string;
  onClose: () => void;
  onCapture: (file: File) => void;
};

async function acquireStream(preferredFacing: WebcamFacingPreference): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera is not supported in this browser.");
  }

  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: preferredFacing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    },
    {
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    },
    { video: true, audio: false },
  ];

  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not access the camera.");
}

export function WebcamCaptureModal({
  open,
  preferredFacing,
  title = "Take a photo",
  onClose,
  onCapture,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setReady(false);
      return;
    }

    let cancelled = false;
    setError(null);
    setReady(false);

    void (async () => {
      try {
        const stream = await acquireStream(preferredFacing);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (!el) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        el.srcObject = stream;
        el.playsInline = true;
        el.muted = true;
        el.onloadedmetadata = () => {
          void el.play().finally(() => {
            if (!cancelled) setReady(true);
          });
        };
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof Error
              ? e.name === "NotAllowedError"
                ? "Camera permission denied. Allow camera access for this site and try again."
                : e.message
              : "Could not access the camera.";
          setError(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const el = videoRef.current;
      if (el) el.srcObject = null;
      setReady(false);
    };
  }, [open, preferredFacing]);

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || !ready) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], "camera.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webcam-capture-title"
    >
      <div className="bg-paper rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-ink/10">
        <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between gap-3">
          <h2 id="webcam-capture-title" className="font-serif text-lg tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink text-xl leading-none px-2 shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="bg-black aspect-video relative">
          {error ? (
            <p className="absolute inset-0 flex items-center justify-center text-white text-sm px-6 text-center">
              {error}
            </p>
          ) : (
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          )}
        </div>
        <div className="p-4 flex flex-wrap gap-3 justify-end border-t border-ink/10 bg-paper-warm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm hover:bg-paper transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={capture}
            disabled={!ready || !!error}
            className="rounded-full bg-ink text-paper px-4 py-2 text-sm hover:bg-ink-soft transition disabled:opacity-50"
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}
