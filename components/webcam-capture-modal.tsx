"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Clock } from "@/components/icons";
import { springSnappy } from "@/lib/ui-motion";

export type WebcamFacingPreference = "environment" | "user";

type Props = {
  open: boolean;
  /** Prefer rear/“world” camera (garments) or front/“user” (selfies). Desktop usually has one camera. */
  preferredFacing: WebcamFacingPreference;
  title?: string;
  onClose: () => void;
  onCapture: (file: File) => void;
};

/** Self-timer choices, in seconds. 0 = shoot immediately. */
const DELAY_OPTIONS = [0, 3, 10] as const;
/** Remembered across opens — someone shooting a rail of garments wants it sticky. */
const DELAY_STORAGE_KEY = "wardrobe:webcam-timer-seconds";

function loadStoredDelay(): number {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(DELAY_STORAGE_KEY));
  return (DELAY_OPTIONS as readonly number[]).includes(raw) ? raw : 0;
}

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
  const [delaySec, setDelaySec] = useState(0);
  /** null = not counting. Counts down to 0, which fires the shutter. */
  const [countdown, setCountdown] = useState<number | null>(null);
  const reduce = useReducedMotion();

  // Restore the remembered delay on the client only, so SSR markup matches.
  useEffect(() => {
    setDelaySec(loadStoredDelay());
  }, []);

  function chooseDelay(next: number) {
    setDelaySec(next);
    setCountdown(null);
    try {
      window.localStorage.setItem(DELAY_STORAGE_KEY, String(next));
    } catch {
      // Private mode / storage disabled — the timer still works this session.
    }
  }

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

  // A running countdown must never outlive the modal, or the shutter fires
  // against a stopped stream after the dialog is gone.
  useEffect(() => {
    if (!open) setCountdown(null);
  }, [open]);

  const capture = useCallback(() => {
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
  }, [ready, onCapture, onClose]);

  // One timeout per tick, driven by state — so React's cleanup cancels it on
  // close, unmount, or a cancel click without any manual interval bookkeeping.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      capture();
      return;
    }
    const id = window.setTimeout(() => {
      setCountdown((n) => (n === null ? null : n - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [countdown, capture]);

  function onShutter() {
    if (!ready || error) return;
    if (countdown !== null) {
      setCountdown(null); // second press cancels a running timer
      return;
    }
    if (delaySec <= 0) {
      capture();
      return;
    }
    setCountdown(delaySec);
  }

  if (!open) return null;

  const counting = countdown !== null;

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

          {/* Countdown overlay. aria-live so it's announced, not just seen. */}
          <AnimatePresence>
            {counting && (
              <motion.div
                key="countdown"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-ink/30 pointer-events-none"
              >
                <motion.span
                  key={countdown}
                  initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={springSnappy}
                  className="font-serif text-white text-[7rem] leading-none tabular-nums drop-shadow-lg"
                >
                  {countdown}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
          <span className="sr-only" aria-live="assertive">
            {counting ? `Capturing in ${countdown}` : ""}
          </span>
        </div>

        <div className="p-4 flex flex-wrap items-center gap-3 border-t border-ink/10 bg-paper-warm">
          {/* Self-timer segmented control */}
          <div
            className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-white p-1"
            role="group"
            aria-label="Self-timer"
          >
            <Clock size={14} className="ml-2 mr-0.5 text-ink-muted shrink-0" />
            {DELAY_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => chooseDelay(opt)}
                aria-pressed={delaySec === opt}
                className={`rounded-full px-2.5 py-1 text-xs tracking-wide transition ${
                  delaySec === opt
                    ? "bg-ink text-paper"
                    : "text-ink-muted hover:text-ink hover:bg-paper-warm"
                }`}
              >
                {opt === 0 ? "Off" : `${opt}s`}
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm hover:bg-paper transition"
            >
              Cancel
            </button>
            <motion.button
              type="button"
              onClick={onShutter}
              disabled={!ready || !!error}
              whileHover={reduce ? undefined : { scale: 1.04 }}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              transition={springSnappy}
              className="rounded-full bg-ink text-paper px-4 py-2 text-sm hover:bg-ink-soft disabled:opacity-50 tabular-nums"
            >
              {counting
                ? `Stop (${countdown})`
                : delaySec > 0
                  ? `Capture in ${delaySec}s`
                  : "Capture"}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
